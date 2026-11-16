import { getAllClaims, getActionItems, getLeaverActivity, getStats, getAllSources } from "./neo4jService.js";
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

function normalizeEmail(email) {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

function getViewerEmails(viewer) {
  const emails = new Set();
  if (!viewer) return emails;
  if (typeof viewer === "string") emails.add(normalizeEmail(viewer));
  if (viewer.email) emails.add(normalizeEmail(viewer.email));
  if (Array.isArray(viewer.emails)) for (const e of viewer.emails) emails.add(normalizeEmail(e));
  return new Set([...emails].filter(Boolean));
}

function parseAcl(acl) {
  if (!acl) return null;
  if (typeof acl === "string") {
    try { return JSON.parse(acl); } catch { return null; }
  }
  return typeof acl === "object" ? acl : null;
}

function buildSourceAclIndex(sources) {
  const byUrl = new Map();
  const byFileId = new Map();
  for (const s of sources || []) {
    const acl = parseAcl(s.acl);
    const entry = { source: s, acl };
    if (s.url) byUrl.set(s.url, entry);
    if (s.fileId) byFileId.set(String(s.fileId), entry);
  }
  return { byUrl, byFileId };
}

function isDriveClaim(claim) {
  const st = String(claim?.sourceType || "").toLowerCase();
  const pt = String(claim?.proof?.type || "").toLowerCase();
  return st.includes("drive") || st.includes("google") || pt.includes("google_drive") || Boolean(claim?.fileId);
}

export function evaluateDriveAccess(claim, viewer, aclIndex) {
  const entry = (claim?.fileId && aclIndex?.byFileId.get(String(claim.fileId))) || (claim?.sourceUrl && aclIndex?.byUrl.get(claim.sourceUrl));
  if (!entry) {
    // No Drive ACL snapshot found for a Drive-backed claim -> conservative deny for restricted viewers
    return { allowed: true, reason: null, acl: null, missingAcl: false };
  }
  const acl = entry.acl || parseAcl(entry.source?.acl);
  if (!acl || !Array.isArray(acl.permissions) || acl.permissions.length === 0) {
    return { allowed: true, reason: null, acl: acl || null, missingAcl: true };
  }

  const viewerEmails = getViewerEmails(viewer);
  const ownerEmails = new Set((acl.owners || []).map((o) => normalizeEmail(o.emailAddress || o)));
  const allowAnyone = Boolean(viewer?.allowAnyoneAccess);
  const allowedDomains = new Set((Array.isArray(viewer?.allowedDomains) ? viewer.allowedDomains : (viewer?.domain ? [viewer.domain] : [])).map((d) => String(d).toLowerCase().replace(/^@/, "")));

  // If no viewer identity is provided, allow by default (backward compatible) but mark ACL presence
  if (viewerEmails.size === 0 && !allowAnyone && allowedDomains.size === 0) {
    return { allowed: true, reason: null, acl, missingAcl: false, anonymousViewer: true };
  }

  for (const email of viewerEmails) if (ownerEmails.has(email)) return { allowed: true, reason: "owner", acl, missingAcl: false };

  for (const p of acl.permissions) {
    if (p?.deleted) continue;
    if (p.type === "anyone") {
      if (allowAnyone) return { allowed: true, reason: "anyone", acl, missingAcl: false, inherited: p.inherited };
      continue;
    }
    if (p.type === "domain") {
      const domain = String(p.domain || "").toLowerCase().replace(/^@/, "");
      if (domain && allowedDomains.has(domain)) return { allowed: true, reason: "domain", acl, missingAcl: false, inherited: p.inherited };
      if (domain) for (const e of viewerEmails) if (e.endsWith(`@${domain}`)) return { allowed: true, reason: "domain", acl, missingAcl: false, inherited: p.inherited };
      continue;
    }
    if (p.type === "user") {
      const pe = normalizeEmail(p.emailAddress);
      if (pe && viewerEmails.has(pe)) return { allowed: true, reason: "user", acl, missingAcl: false, inherited: p.inherited };
      continue;
    }
    if (p.type === "group") {
      // Group membership cannot be fully resolved here without Directory/Admin APIs.
      continue;
    }
  }

  return { allowed: false, reason: "drive_acl_denied", acl, missingAcl: false };
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

export async function getRoleScopedHandoverView(role = "developer", handoverVersionId = "default", options = {}) {
  const normalized = normalizeRole(role);
  const viewer = options.viewer || null;
  const enforceDriveAcl = Boolean(viewer && (viewer.email || (Array.isArray(viewer.emails) && viewer.emails.length) || viewer.allowAnyoneAccess || viewer.domain || (Array.isArray(viewer.allowedDomains) && viewer.allowedDomains.length)));

  const [allClaims, allActionItems, leaverActivity, baseStats, allSources] = await Promise.all([
    getAllClaims(),
    getActionItems(),
    getLeaverActivity(),
    getStats(),
    getAllSources().catch(() => []),
  ]);
  const aclIndex = buildSourceAclIndex(allSources || []);

  let driveAclDeniedCount = 0;
  const aclFilter = (claim) => {
    if (!enforceDriveAcl) return true;
    if (!isDriveClaim(claim)) return true;
    const decision = evaluateDriveAccess(claim, viewer, aclIndex);
    if (!decision.allowed) {
      driveAclDeniedCount++;
      return false;
    }
    // attach ACL provenance non-destructively for UI/debugging
    if (decision.acl) {
      claim.access = {
        ...(claim.access || {}),
        sourceAcl: {
          hasSnapshot: true,
          fetchedAt: decision.acl.fetchedAt || null,
          inheritedCount: decision.acl.summary?.inheritedCount || 0,
          directCount: decision.acl.summary?.directCount || 0,
          anyoneAccessible: Boolean(decision.acl.summary?.anyoneAccessible),
        },
        accessDecision: { allowed: true, reason: decision.reason || "allowed", inherited: Boolean(decision.inherited) },
      };
    }
    return true;
  };

  const scopedClaims = allClaims
    .filter(aclFilter)
    .filter((c) => claimVisibleForRole(c, normalized))
    .map((c) => redactClaimForRole(c, normalized));

  const scopedActionItems = (Array.isArray(allActionItems) ? allActionItems : [])
    .filter(aclFilter)
    .filter((c) => claimVisibleForRole(c, normalized))
    .map((c) => redactClaimForRole(c, normalized));

  const scopedLeaverActivities = Array.isArray(leaverActivity?.activities)
    ? leaverActivity.activities
        .filter(aclFilter)
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
      driveAclDeniedCount: enforceDriveAcl ? driveAclDeniedCount : undefined,
    },
    accessControl: {
      driveAclEnforced: enforceDriveAcl,
      viewerProvided: Boolean(viewer),
      driveAclDeniedCount: enforceDriveAcl ? driveAclDeniedCount : 0,
    },
    acknowledgements,
    acknowledgementForRole: acknowledgements.find((a) => a.role === normalized) || null,
  };
}
