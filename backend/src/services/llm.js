import OpenAI from "openai";
import { env } from "../config.js";

let client = null;

function getProvider() {
  return (env.LLM_PROVIDER || process.env.LLM_PROVIDER || "groq").toLowerCase();
}

export function isLLMEnabled() {
  if (getProvider() === "disabled" || getProvider() === "none") return false;
  return Boolean(env.GROQ_API_KEY || process.env.GROQ_API_KEY);
}

function getClient() {
  if (client) return client;
  const apiKey = env.GROQ_API_KEY || process.env.GROQ_API_KEY;
  if (!apiKey) return null;

  client = new OpenAI({
    apiKey,
    baseURL: env.GROQ_BASE_URL || process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1",
  });
  return client;
}

function truncate(text, max = 6000) {
  if (typeof text !== "string") return "";
  return text.length > max ? text.slice(0, max) + "\n...[truncated]" : text;
}

function extractJsonCandidate(text) {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  if (!trimmed) return null;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) return fenced[1].trim();

  const firstObj = trimmed.indexOf("{");
  const lastObj = trimmed.lastIndexOf("}");
  if (firstObj !== -1 && lastObj !== -1 && lastObj > firstObj) {
    return trimmed.slice(firstObj, lastObj + 1);
  }

  const firstArr = trimmed.indexOf("[");
  const lastArr = trimmed.lastIndexOf("]");
  if (firstArr !== -1 && lastArr !== -1 && lastArr > firstArr) {
    return trimmed.slice(firstArr, lastArr + 1);
  }

  return trimmed;
}

function parseJsonSafe(text, fallback) {
  const candidate = extractJsonCandidate(text);
  if (!candidate) return fallback;
  try {
    return JSON.parse(candidate);
  } catch (e) {
    // Try to repair common trailing commas
    try {
      const repaired = candidate.replace(/,\s*([}\]])/g, "$1");
      return JSON.parse(repaired);
    } catch {
      return fallback;
    }
  }
}

function clampConfidence(value, fallback = 0.5) {
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => {
      if (typeof v === "string") return v.trim();
      if (v && typeof v === "object") {
        return String(v.text || v.title || v.name || v.description || v.summary || "").trim();
      }
      return "";
    })
    .filter(Boolean);
}

export async function callLLM(prompt, options = {}) {
  const llmClient = getClient();
  if (!llmClient || getProvider() !== "groq") {
    throw new Error("LLM unavailable: set GROQ_API_KEY and LLM_PROVIDER=groq");
  }

  const model = options.model || env.GROQ_MODEL || process.env.GROQ_MODEL || "llama-3.1-8b-instant";
  const temperature = typeof options.temperature === "number" ? options.temperature : 0.2;
  const maxTokens = typeof options.maxTokens === "number" ? options.maxTokens : 700;
  const system = options.system || "You are a precise assistant. Return valid JSON only when asked for JSON.";

  const response = await llmClient.chat.completions.create({
    model,
    temperature,
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
  });

  return response?.choices?.[0]?.message?.content?.trim() || "";
}

export async function extractClaims(sourceText, sourceType) {
  const defaults = { decisions: [], openQuestions: [], tasks: [], dependencies: [], risks: [], contacts: [] };
  if (!isLLMEnabled()) return defaults;
  if (!sourceText || String(sourceText).trim().length < 10) return defaults;

  const prompt = `Extract structured handover claims from the following ${sourceType || "source"}.
Return ONLY valid JSON with this exact shape:
{
  "decisions": ["string"],
  "openQuestions": ["string"],
  "tasks": ["string"],
  "dependencies": ["string"],
  "risks": ["string"],
  "contacts": ["string"]
}
Rules:
- Use concise, factual items grounded in the text.
- Do not invent details.
- If a category has no items, return an empty array.

SOURCE TEXT:
${truncate(sourceText, 7000)}`;

  try {
    const raw = await callLLM(prompt, { temperature: 0.1, maxTokens: 900 });
    const parsed = parseJsonSafe(raw, defaults) || {};
    return {
      decisions: normalizeStringArray(parsed.decisions),
      openQuestions: normalizeStringArray(parsed.openQuestions || parsed.open_questions),
      tasks: normalizeStringArray(parsed.tasks),
      dependencies: normalizeStringArray(parsed.dependencies),
      risks: normalizeStringArray(parsed.risks),
      contacts: normalizeStringArray(parsed.contacts),
    };
  } catch (e) {
    console.warn("extractClaims LLM failed:", e.message);
    return defaults;
  }
}

export async function detectContradictions(claimA, claimB, context = "") {
  const defaults = { isContradiction: false, confidence: 0, explanation: "LLM unavailable or no contradiction detected" };
  if (!isLLMEnabled()) return defaults;

  const prompt = `Determine whether these two handover claims contradict each other.
Return ONLY valid JSON with this exact shape:
{
  "isContradiction": boolean,
  "confidence": number,
  "explanation": "short string"
}

CONTEXT:
${truncate(context, 1500)}

CLAIM A:
${truncate(String(claimA || ""), 1500)}

CLAIM B:
${truncate(String(claimB || ""), 1500)}

Guidance:
- "isContradiction" true only if both claims cannot reasonably be true together.
- "confidence" must be between 0 and 1.
- Keep explanation factual and brief.`;

  try {
    const raw = await callLLM(prompt, { temperature: 0, maxTokens: 300 });
    const parsed = parseJsonSafe(raw, defaults) || {};
    return {
      isContradiction: Boolean(parsed.isContradiction ?? parsed.contradiction ?? parsed.scontradiction),
      confidence: clampConfidence(parsed.confidence, 0),
      explanation: typeof parsed.explanation === "string" && parsed.explanation.trim()
        ? parsed.explanation.trim()
        : defaults.explanation,
    };
  } catch (e) {
    console.warn("detectContradictions LLM failed:", e.message);
    return defaults;
  }
}

export async function scoreConfidence(claimText, sourceType, sourceDate, corroborationCount = 1) {
  const defaults = { score: 0.5, reasoning: "Default confidence (LLM unavailable)" };
  if (!isLLMEnabled()) return defaults;

  const prompt = `Score the confidence of this handover claim.
Return ONLY valid JSON with this exact shape:
{
  "score": number,
  "reasoning": "short string"
}

CLAIM:
${truncate(String(claimText || ""), 2000)}

SOURCE TYPE: ${String(sourceType || "unknown")}
SOURCE DATE: ${String(sourceDate || "unknown")}
CORROBORATION COUNT: ${Number(corroborationCount) || 1}

Guidance:
- "score" must be between 0 and 1.
- Higher when specific, recent, and corroborated by source context.
- Lower when vague, speculative, or weakly supported.`;

  try {
    const raw = await callLLM(prompt, { temperature: 0, maxTokens: 250 });
    const parsed = parseJsonSafe(raw, defaults) || {};
    return {
      score: clampConfidence(parsed.score, 0.5),
      reasoning: typeof parsed.reasoning === "string" && parsed.reasoning.trim()
        ? parsed.reasoning.trim()
        : defaults.reasoning,
    };
  } catch (e) {
    console.warn("scoreConfidence LLM failed:", e.message);
    return defaults;
  }
}

export async function summarizeMeeting(meetingText, meetingMetadata = {}) {
  const defaults = { decisions: [], actionItems: [], openQuestions: [], risks: [] };
  if (!isLLMEnabled()) return defaults;
  if (!meetingText || String(meetingText).trim().length < 10) return defaults;

  const prompt = `Summarize this meeting transcript for a knowledge handover.
Return ONLY valid JSON with this exact shape:
{
  "decisions": ["string"],
  "actionItems": ["string"],
  "openQuestions": ["string"],
  "risks": ["string"]
}

MEETING METADATA:
${truncate(JSON.stringify(meetingMetadata || {}, null, 2), 1500)}

TRANSCRIPT:
${truncate(String(meetingText), 7000)}

Rules:
- Be concise and factual.
- Include owners/deadlines in action items only if explicitly stated.
- Do not invent details.`;

  try {
    const raw = await callLLM(prompt, { temperature: 0.1, maxTokens: 900 });
    const parsed = parseJsonSafe(raw, defaults) || {};
    return {
      decisions: normalizeStringArray(parsed.decisions),
      actionItems: normalizeStringArray(parsed.actionItems || parsed.action_items),
      openQuestions: normalizeStringArray(parsed.openQuestions || parsed.open_questions),
      risks: normalizeStringArray(parsed.risks),
    };
  } catch (e) {
    console.warn("summarizeMeeting LLM failed:", e.message);
    return defaults;
  }
}
