import crypto from "crypto";
import { summarizeMeeting, scoreConfidence, isLLMEnabled } from "./llm.js";
import { createClaim, createSource, getAllClaims } from "./neo4jService.js";
import { claims, sources } from "../store.js";

export const MEETING_SUMMARY_CONFIDENCE_CAP = 0.6;

const CATEGORY_TO_CLAIM_TYPE = {
  decisions: "decision",
  actionItems: "task",
  openQuestions: "question",
  risks: "risk",
};

function normalizeProvider(provider) {
  const raw = String(provider || "unknown").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!raw) return "unknown";
  return raw;
}

function normalizeParticipants(participants) {
  if (!Array.isArray(participants)) return [];
  return participants
    .map((p) => {
      if (typeof p === "string") return { name: p.trim(), email: null };
      if (p && typeof p === "object") {
        return {
          name: p.name ? String(p.name).trim() : null,
          email: p.email ? String(p.email).trim().toLowerCase() : null,
          role: p.role ? String(p.role).trim() : null,
        };
      }
      return null;
    })
    .filter((p) => p && (p.name || p.email));
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((v) => (typeof v === "string" ? v.trim() : String(v?.text || v || "").trim())).filter(Boolean);
}

function buildMeetingText(payload) {
  const parts = [];
  if (payload.summaryText) parts.push(String(payload.summaryText));
  if (payload.transcriptText) parts.push(String(payload.transcriptText));
  if (Array.isArray(payload.actionItems) && payload.actionItems.length) {
    parts.push("Action items:\n" + payload.actionItems.map((a) => `- ${typeof a === "string" ? a : JSON.stringify(a)}`).join("\n"));
  }
  return parts.join("\n\n").trim();
}

function excerpt(text, max = 240) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function stableMeetingId(payload) {
  if (payload.meetingId) return String(payload.meetingId).trim();
  const seed = [payload.provider, payload.title, payload.occurredAt, payload.summaryText || payload.transcriptText || ""].join("|");
  return "meeting-" + crypto.createHash("sha1").update(seed).digest("hex").slice(0, 16);
}

function sourceUrlForMeeting(provider, meetingId, explicitUrl) {
  if (explicitUrl && String(explicitUrl).trim()) return String(explicitUrl).trim();
  return `meeting://${provider}/${encodeURIComponent(meetingId)}`;
}

async function safeCreateClaim(claim) {
  try {
    const created = await createClaim(claim);
    if (!claims.find((c) => c.id === claim.id)) claims.push(created || claim);
    return created || claim;
  } catch (e) {
    if (!claims.find((c) => c.id === claim.id)) claims.push(claim);
    return claim;
  }
}

async function safeCreateSource(source) {
  try {
    return await createSource(source);
  } catch (e) {
    const idx = sources.findIndex((s) => s.url === source.url || (source.meetingId && s.meetingId === source.meetingId && s.provider === source.provider));
    if (idx >= 0) sources[idx] = { ...sources[idx], ...source };
    else sources.push(source);
    return source;
  }
}

export function applyMeetingAuthorityPolicy(claim) {
  const isLowAuthorityMeeting = claim?.sourceType === "meeting_summary" && String(claim?.sourceAuthority || "low").toLowerCase() === "low";
  const corroborated = Boolean(claim?.corroborated);
  if (!isLowAuthorityMeeting) return claim;

  const corroboratedBy = Array.isArray(claim.corroboratedBy) ? claim.corroboratedBy : (claim.corroboratedBy ? [claim.corroboratedBy] : []);
  claim.corroborationCount = Number.isFinite(Number(claim.corroborationCount)) ? Number(claim.corroborationCount) : corroboratedBy.length;
  claim.corroborated = corroborated || claim.corroborationCount > 0;

  if (!claim.corroborated) {
    const base = typeof claim.confidence === "number" ? claim.confidence : 0.5;
    claim.confidence = Math.max(0, Math.min(MEETING_SUMMARY_CONFIDENCE_CAP, base));
    claim.needsCorroboration = true;
  } else {
    claim.needsCorroboration = false;
  }

  claim.proof = {
    ...(claim.proof && typeof claim.proof === "object" ? claim.proof : {}),
    authority: "low",
    corroborated: Boolean(claim.corroborated),
    confidenceCap: claim.corroborated ? null : MEETING_SUMMARY_CONFIDENCE_CAP,
  };
  return claim;
}

async function summarizePayload(payload, meetingText) {
  const metadata = {
    provider: payload.provider,
    meetingId: payload.meetingId,
    title: payload.title || null,
    occurredAt: payload.occurredAt || null,
    participants: payload.participants || [],
    sourceUrl: payload.sourceUrl || null,
    ...(payload.metadata && typeof payload.metadata === "object" ? payload.metadata : {}),
  };

  let summary = { decisions: [], actionItems: [], openQuestions: [], risks: [] };
  if (meetingText && isLLMEnabled()) {
    try {
      summary = await summarizeMeeting(meetingText, metadata);
    } catch (e) {
      console.warn("summarizeMeeting failed, falling back:", e.message);
    }
  }

  // Merge provider-native action items if LLM omitted them
  const nativeActions = normalizeStringArray(payload.actionItems);
  if (nativeActions.length) {
    const existing = new Set(normalizeStringArray(summary.actionItems).map((s) => s.toLowerCase()));
    summary.actionItems = [...normalizeStringArray(summary.actionItems), ...nativeActions.filter((a) => !existing.has(a.toLowerCase()))];
  }

  // Heuristic fallback for pasted summaries without LLM: extract simple bullets/lines
  const hasAny = Object.values(summary || {}).some((arr) => Array.isArray(arr) && arr.length > 0);
  if (!hasAny && meetingText) {
    const lines = meetingText.split(/\r?\n/).map((l) => l.replace(/^[\-\*\d\.\)\s]+/, "").trim()).filter((l) => l.length > 12);
    const lower = (s) => s.toLowerCase();
    for (const line of lines.slice(0, 40)) {
      if (/(decid|agreed|approved|we will use|concluded)/i.test(line)) summary.decisions.push(line);
      else if (/(action|todo|follow.?up|owner:|deadline|by\s+\w+day)/i.test(line)) summary.actionItems.push(line);
      else if (/(risk|concern|blocker|issue|might fail)/i.test(line)) summary.risks.push(line);
      else if (/\?|^(how|what|when|who|why|can we|should we)/i.test(line)) summary.openQuestions.push(line);
    }
    // If still empty, store a generic decision/task-like summary claim from the text
    if (!Object.values(summary).some((arr) => arr.length)) {
      summary.decisions.push(excerpt(meetingText, 300));
    }
  }

  return {
    decisions: normalizeStringArray(summary.decisions),
    actionItems: normalizeStringArray(summary.actionItems || summary.action_items),
    openQuestions: normalizeStringArray(summary.openQuestions || summary.open_questions),
    risks: normalizeStringArray(summary.risks),
  };
}

export async function ingestMeetingSummary(rawPayload = {}) {
  const provider = normalizeProvider(rawPayload.provider);
  const meetingId = stableMeetingId({ ...rawPayload, provider });
  const meetingText = buildMeetingText(rawPayload);
  if (!meetingText) {
    const err = new Error("meeting summary/transcript text is required (summaryText, transcriptText, or actionItems)");
    err.status = 400;
    throw err;
  }

  const title = rawPayload.title ? String(rawPayload.title).trim() : null;
  const occurredAt = rawPayload.occurredAt ? String(rawPayload.occurredAt) : new Date().toISOString();
  const sourceUrl = sourceUrlForMeeting(provider, meetingId, rawPayload.sourceUrl);
  const participants = normalizeParticipants(rawPayload.participants);
  const author = rawPayload.author || participants[0]?.name || provider;

  // Idempotency: skip if we already have claims for this meeting source
  const existing = claims.filter((c) => c.meetingId === meetingId || c.sourceUrl === sourceUrl || c?.proof?.meetingId === meetingId);
  if (existing.length > 0) {
    return {
      message: `Meeting summary already ingested (${existing.length} existing claims)`,
      provider,
      meetingId,
      sourceUrl,
      idempotent: true,
      claimsCreated: 0,
      claims: existing.slice(0, 50),
      totalClaims: existing.length,
    };
  }

  const source = await safeCreateSource({
    url: sourceUrl,
    type: "meeting_summary",
    provider,
    meetingId,
    sourceAuthority: "low",
    occurredAt,
    author,
    content: excerpt(meetingText, 2000),
    metadata: {
      title,
      participants,
      sourceUrl: rawPayload.sourceUrl || null,
      inputKinds: [rawPayload.summaryText ? "summaryText" : null, rawPayload.transcriptText ? "transcriptText" : null].filter(Boolean),
      ...(rawPayload.metadata && typeof rawPayload.metadata === "object" ? rawPayload.metadata : {}),
    },
    createdAt: occurredAt,
  });

  const summarized = await summarizePayload({ ...rawPayload, provider, meetingId, occurredAt, participants, sourceUrl, title }, meetingText);
  const createdClaims = [];
  const diagnostics = { categories: {}, llmEnabled: isLLMEnabled(), warnings: [] };

  for (const [category, items] of Object.entries(summarized)) {
    const claimType = CATEGORY_TO_CLAIM_TYPE[category] || "insight";
    diagnostics.categories[category] = Array.isArray(items) ? items.length : 0;
    for (const item of items || []) {
      const text = typeof item === "string" ? item : String(item || "");
      if (!text.trim()) continue;

      let confidence = 0.55; // base for AI meeting summaries
      try {
        const scored = await scoreConfidence(text, "meeting_summary", occurredAt, 1);
        confidence = typeof scored?.score === "number" ? scored.score : confidence;
      } catch (e) {
        diagnostics.warnings.push(`scoreConfidence: ${e.message}`);
      }

      const claim = applyMeetingAuthorityPolicy({
        id: `meeting-${provider}-${meetingId}-${createdClaims.length}-${Date.now().toString(36)}`,
        type: claimType,
        text,
        confidence,
        status: "proposed",
        sourceUrl,
        sourceType: "meeting_summary",
        sourceProvider: provider,
        meetingId,
        sourceAuthority: "low",
        corroborated: false,
        corroboratedBy: [],
        corroborationCount: 0,
        needsCorroboration: true,
        createdAt: occurredAt,
        updatedAt: occurredAt,
        author,
        proof: {
          type: "meeting_summary",
          provider,
          meetingId,
          title,
          occurredAt,
          participants,
          sourceUrl: rawPayload.sourceUrl || sourceUrl,
          excerpt: excerpt(text, 220),
          category,
          authority: "low",
          corroborated: false,
        },
      });

      await safeCreateClaim(claim);
      createdClaims.push(claim);
    }
  }

  return {
    message: `Ingested meeting summary (${provider}) with ${createdClaims.length} claims`,
    provider,
    meetingId,
    sourceUrl,
    source,
    claimsCreated: createdClaims.length,
    claims: createdClaims,
    totalClaims: claims.length,
    diagnostics,
    policy: {
      sourceAuthority: "low",
      confidenceCap: MEETING_SUMMARY_CONFIDENCE_CAP,
      cappedUntilCorroborated: true,
    },
  };
}