import { getAllClaims, getActionItems, getLeaverActivity, getStats } from "./neo4jService.js";
import { query, ensureConnection } from "../db/postgres.js";

const ROLES = ["developer", "pm", "new_hire"];

const ROLE_LABELS = {
  developer: "Developer",
  pm: "PM",
  new_hire: "New Hire",
};

const inMemoryAcknowledgements = new Map(); // key: `${handoverVersionId}:${role}`

export function normalizeRole(role) {
  if (!role) return "developer";
  const r = String(role).toLowerCase().replace(/[\s-]+/g, "_");
  if (r === "newhire") return "new_hire";
  return ROLES.includes(r) ? r : "developer";
}

export function getRoleConfig(role) {
  const normalized = normalizeRole(role);
  return { role: normalized, label: ROLE_LABELS[normalized] || "Developer" };
}

function maskSensitive(text) {
  if (!text || typeof text !== "string") return text;
  let redacted = text;
  const patterns = [
    { re: /(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g, rep: "[REDACTED_GITHUB_TOKEN]" },
    { re: /(sk-[A-Za-z0-9]{16,})/g, rep: "[REDACTED_API_KEY]" },
    { re: /(AKIA[0-9A-Z]{16})/g, rep: "[REDACTED_AWS_KEY]" },
    { re: /((?:api[_-]?key|token|secret|password|passwd|pwd)\s*[:=]\s*)([^\s,;"']+)/gi, rep: "$1[REDACTED]" },
    { re: /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g, rep: "[REDACTED_EMAIL]" },
  ];
  for (const { re, rep } of patterns) redacted = redacted.replace(re, rep);
  return redacted;
}

function includesAny(text, terms) {
  const t = (text || "").toLowerCase();
  return terms.some((term) => t.includes(term));
}

function redactClaimForRole(claim, role) {
  const normalized = normalizeRole(role);
  const base = { ...claim };
  const sensitive = includesAny(`${claim.text || ""} ${claim.body || ""}`, [
    "password", "secret", "api_key", "private_key", "credential", "token", "passwd", "pwd",
  ]);
  const isReviewComment = claim.type === "pr_review_comment";
  const isComment = claim.type === "pr_comment" || claim.type === "issue_comment" || isReviewComment;
  const isLowLevel = isReviewComment || (isComment && !claim.isLeaver);

  if (normalized === "developer") {
    return {
      ...base,
      text: maskSensitive(claim.text),
      body: maskSensitive(claim.body),
      redacted: sensitive,
      redactionLevel: sensitive ? "partial" : "none",
      redactionReason: sensitive ? "Sensitive values masked for safety." : null,
    };
  }

  if (normalized === "pm") {
    const hideDetail = isLowLevel && !sensitive;
    return {
      ...base,
      text: sensitive ? "[Redacted for PM view: sensitive details]" : maskSensitive(claim.text),
      body: hideDetail || sensitive ? undefined : maskSensitive(claim.body),
      labels: Array.isArray(claim.labels) ? claim.labels : [],
      reviewers: undefined,
      redacted: Boolean(hideDetail || sensitive),
      redactionLevel: sensitive ? "full" : hideDetail ? "partial" : "none",
      redactionReason: sensitive
        ? "Contains sensitive details not shown in PM view."
        : hideDetail
        ? "Low-level review/comment detail hidden in PM view."
        : null,
    };
  }

  // new_hire: onboarding-focused, hide noisy/sensitive/low-level details
  const hideForOnboarding = isLowLevel || claim.type === "closed_pr" || claim.type === "closed_issue";
  if (sensitive) {
    return {
      ...base,
      text: "[Redacted for New Hire view: sensitive details]",
      body: undefined,
      labels: undefined,
      reviewers: undefined,
      assignees: Array.isArray(claim.assignees) ? claim.assignees : undefined,
      redacted: true,
      redactionLevel: "full",
      redactionReason: "Sensitive details are not shown in New Hire view.",
    };
  }
  if (hideForOnboarding) {
    return {
      ...base,
      text: `[Summarized for New Hire view] ${(claim.text || "").slice(0, 140)}${(claim.text || "").length > 140 ? "…" : ""}`,
      body: undefined,
      reviewers: undefined,
      redacted: true,
      redactionLevel: "partial",
      redactionReason: "Low-level or closed-history detail summarized for onboarding.",
    };
  }
  return {
    ...base,
    text: maskSensitive(claim.text),
    body: maskSensitive(claim.body),
    reviewers: undefined,
    redacted: false,
    redactionLevel: "none",
    redactionReason: null,
  };
}

function claimVisibleForRole(claim, role) {
  const normalized = normalizeRole(role);
  if (normalized === "developer") return true;
  if (normalized === "pm") {
    // PM focuses on status, decisions, risks, tasks, dependencies, blockers, ownership
    const focusTypes = new Set([
      "open_pr", "open_issue", "merged_pr", "closed_pr", "closed_issue",
      "decision", "task", "risk", "dependency", "question", "insight", "contact", "issue_comment",
    ]);
    if (claim.isLeaver) return true;
    if (focusTypes.has(claim.type)) return true;
    if (claim.status === "open" || claim.status === "proposed") return true;
    return false;
  }
  // new_hire: onboarding-relevant, reduce noise
  const onboardingTypes = new Set([
    "open_pr", "open_issue", "merged_pr", "decision", "task", "risk", "dependency", "question", "contact", "insight",
  ]);
  if (onboardingTypes.has(claim.type)) return true;
  if (claim.status === "open" || claim.status === "proposed") return true;
  if (claim.isLeaver && !String(claim.type).includes("review_comment")) return true;
  return false;
}

function computeRoleStats(claims) {
  return {
    totalClaims: claims.length,
    openCount: claims.filter((c) => c.status === "open" || c.status === "proposed").length,
    mergedCount: claims.filter((c) => c.status === "merged").length,
    closedCount: claims.filter((c) => c.status === "closed").length,
    leaverActivities: claims.filter((c) => c.isLeaver).length,
    redactedCount: claims.filter((c) => c.redacted).length,
    claimTypes: [...new Set(claims.map((c) => c.type))],
  };
}

export async function getAcknowledgements(handoverVersionId = "default") {
  try {
    const pg = await ensureConnection();
    if (pg) {
      const res = await query(
        `SELECT handover_version_id, role, acknowledged_by, acknowledged_at, notes
         FROM handover_acknowledgements
         WHERE handover_version_id = $1
         ORDER BY acknowledged_at DESC`,
        [handoverVersionId]
      );
      return res.rows.map((r) => ({
        handoverVersionId: r.handover_version_id,
        role: r.role,
        acknowledgedBy: r.acknowledged_by,
        acknowledgedAt: r.acknowledged_at,
        notes: r.notes || null,
      }));
    }
  } catch (e) {
    // fall through to memory
  }
  const out = [];
  for (const [key, value] of inMemoryAcknowledgements.entries()) {
    if (key.startsWith(`${handoverVersionId}:`)) out.push(value);
  }
  return out.sort((a, b) => new Date(b.acknowledgedAt) - new Date(a.acknowledgedAt));
}

export async function acknowledgeHandover({ handoverVersionId = "default", role, acknowledgedBy = null, notes = null }) {
  const normalized = normalizeRole(role);
  const record = {
    handoverVersionId,
    role: normalized,
    acknowledgedBy: acknowledgedBy || null,
    acknowledgedAt: new Date().toISOString(),
    notes: notes || null,
  };

  try {
    const pg = await ensureConnection();
    if (pg) {
      await query(
        `INSERT INTO handover_acknowledgements (handover_version_id, role, acknowledged_by, notes, acknowledged_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (handover_version_id, role)
         DO UPDATE SET acknowledged_by = EXCLUDED.acknowledged_by,
                       notes = EXCLUDED.notes,
                       acknowledged_at = NOW()`,
        [handoverVersionId, normalized, acknowledgedBy || null, notes || null]
      );
      return record;
    }
  } catch (e) {
    // fall through to memory
  }

  inMemoryAcknowledgements.set(`${handoverVersionId}:${normalized}`, record);
  return record;
}

export async function getRoleScopedHandoverView(role = "developer", handoverVersionId = "default") {
  const normalized = normalizeRole(role);
  const [allClaims, allActionItems, leaverActivity, baseStats] = await Promise.all([
    getAllClaims(),
    getActionItems(),
    getLeaverActivity(),
    getStats(),
  ]);

  const scopedClaims = allClaims
    .filter((c) => claimVisibleForRole(c, normalized))
    .map((c) => redactClaimForRole(c, normalized));

  const scopedActionItems = (Array.isArray(allActionItems) ? allActionItems : [])
    .filter((c) => claimVisibleForRole(c, normalized))
    .map((c) => redactClaimForRole(c, normalized));

  const scopedLeaverActivities = Array.isArray(leaverActivity?.activities)
    ? leaverActivity.activities
        .filter((c) => claimVisibleForRole(c, normalized))
        .map((c) => redactClaimForRole(c, normalized))
    : [];

  const acknowledgements = await getAcknowledgements(handoverVersionId);

  return {
    handoverVersionId,
    role: normalized,
    roleLabel: ROLE_LABELS[normalized],
    availableRoles: ROLES.map((r) => ({ role: r, label: ROLE_LABELS[r] })),
    claims: scopedClaims,
    actionItems: scopedActionItems,
    leaverActivity: {
      ...(leaverActivity || {}),
      activities: scopedLeaverActivities,
      totalActivities: scopedLeaverActivities.length,
    },
    stats: {
      ...(baseStats || {}),
      ...computeRoleStats(scopedClaims),
    },
    acknowledgements,
    acknowledgementForRole: acknowledgements.find((a) => a.role === normalized) || null,
  };
}
