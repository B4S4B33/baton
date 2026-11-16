import { getSession, closeDriver } from "../db/neo4j.js";
import { claims, sources, stats } from "../store.js";

/**
 * Neo4j Service - Graph database operations for claims, sources, and stats
 * Falls back gracefully to in-memory storage when Neo4j is unavailable
 */

let neo4jConnected = false;
let connectionAttempted = false;

const CONNECT_TIMEOUT_MS = Number(process.env.NEO4J_CONNECT_TIMEOUT_MS) || 8000;

async function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function ensureConnection() {
  if (neo4jConnected) return true;
  // Retry connection attempts periodically instead of permanently falling back after first failure.
  // (keeps startup resilient but allows recovery if env/network becomes available)

  try {
    const session = getSession();
    await withTimeout(session.run("RETURN 1"), CONNECT_TIMEOUT_MS, "Neo4j connectivity check");
    await session.close();
    if (!neo4jConnected) console.log("Neo4j connected successfully");
    neo4jConnected = true;
    return true;
  } catch (e) {
    if (neo4jConnected || !connectionAttempted) {
      console.warn("Neo4j not available, using in-memory storage:", e.message);
    }
    connectionAttempted = true;
    neo4jConnected = false;
    return false;
  }
}

// --- Claim Operations ---

function parseJsonMaybe(value) {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return value; }
}

function normalizeClaimForStorage(claim) {
  const proof = claim.proof;
  const corroboratedBy = claim.corroboratedBy;
  const access = claim.access;
  return {
    id: claim.id,
    type: claim.type || null,
    text: claim.text || null,
    confidence: claim.confidence ?? 0.5,
    status: claim.status || "proposed",
    sourceUrl: claim.sourceUrl || null,
    sourceType: claim.sourceType || null,
    createdAt: claim.createdAt || new Date().toISOString(),
    updatedAt: claim.updatedAt || claim.createdAt || new Date().toISOString(),
    author: claim.author || null,
    isLeaver: claim.isLeaver ?? false,
    body: claim.body || null,
    labels: Array.isArray(claim.labels) ? claim.labels : (claim.labels ? [String(claim.labels)] : []),
    assignees: Array.isArray(claim.assignees) ? claim.assignees : (claim.assignees ? [String(claim.assignees)] : []),
    reviewers: Array.isArray(claim.reviewers) ? claim.reviewers : (claim.reviewers ? [String(claim.reviewers)] : []),
    parentPr: claim.parentPr ?? null,
    parentPrTitle: claim.parentPrTitle || null,
    parentIssue: claim.parentIssue ?? null,
    parentIssueTitle: claim.parentIssueTitle || null,
    fileName: claim.fileName || null,
    fileId: claim.fileId || null,
    sourceProvider: claim.sourceProvider || claim.provider || null,
    meetingId: claim.meetingId || null,
    sourceAuthority: claim.sourceAuthority || null,
    corroborated: claim.corroborated ?? false,
    corroborationCount: Number.isFinite(Number(claim.corroborationCount)) ? Number(claim.corroborationCount) : (Array.isArray(corroboratedBy) ? corroboratedBy.length : 0),
    corroboratedBy: corroboratedBy == null ? null : (typeof corroboratedBy === "string" ? corroboratedBy : JSON.stringify(corroboratedBy)),
    needsCorroboration: claim.needsCorroboration ?? false,
    proof: proof == null ? null : (typeof proof === "string" ? proof : JSON.stringify(proof)),
    access: access == null ? null : (typeof access === "string" ? access : JSON.stringify(access)),
  };
}

function hydrateClaim(claim) {
  if (!claim) return claim;
  const out = { ...claim };
  if (typeof out.proof === "string") out.proof = parseJsonMaybe(out.proof);
  if (typeof out.corroboratedBy === "string") out.corroboratedBy = parseJsonMaybe(out.corroboratedBy);
  if (typeof out.access === "string") out.access = parseJsonMaybe(out.access);
  if (Array.isArray(out.corroboratedBy)) {
    out.corroborationCount = Number.isFinite(Number(out.corroborationCount)) ? Number(out.corroborationCount) : out.corroboratedBy.length;
  } else if (out.corroboratedBy == null && !Number.isFinite(Number(out.corroborationCount))) {
    out.corroborationCount = 0;
  }
  return out;
}

export async function createClaim(claim) {
  const normalized = normalizeClaimForStorage(claim);
  const connected = await ensureConnection();
  if (!connected) {
    const stored = hydrateClaim({ ...claim, ...normalized, proof: claim.proof ?? null, corroboratedBy: claim.corroboratedBy ?? null, access: claim.access ?? null });
    claims.push(stored);
    return stored;
  }

  const session = getSession();
  try {
    const result = await session.run(
      `CREATE (c:Claim {
        id: $id,
        type: $type,
        text: $text,
        confidence: $confidence,
        status: $status,
        sourceUrl: $sourceUrl,
        sourceType: $sourceType,
        createdAt: $createdAt,
        updatedAt: $updatedAt,
        author: $author,
        isLeaver: $isLeaver,
        body: $body,
        labels: $labels,
        assignees: $assignees,
        reviewers: $reviewers,
        parentPr: $parentPr,
        parentPrTitle: $parentPrTitle,
        parentIssue: $parentIssue,
        parentIssueTitle: $parentIssueTitle,
        fileName: $fileName,
        fileId: $fileId,
        sourceProvider: $sourceProvider,
        meetingId: $meetingId,
        sourceAuthority: $sourceAuthority,
        corroborated: $corroborated,
        corroborationCount: $corroborationCount,
        corroboratedBy: $corroboratedBy,
        needsCorroboration: $needsCorroboration,
        proof: $proof,
        access: $access
      })
      RETURN c`,
      normalized
    );
    return hydrateClaim(result.records[0].get("c").properties);
  } finally {
    await session.close();
  }
}

export async function getAllClaims(filters = {}) {
  const connected = await ensureConnection();
  if (!connected) {
    let filtered = claims.map(hydrateClaim);
    if (filters.status) filtered = filtered.filter((c) => c.status === filters.status);
    if (filters.type) filtered = filtered.filter((c) => c.type === filters.type);
    if (filters.isLeaver !== undefined) filtered = filtered.filter((c) => c.isLeaver === filters.isLeaver);
    return filtered;
  }

  const session = getSession();
  try {
    let query = "MATCH (c:Claim)";
    const params = {};
    const conditions = [];

    if (filters.status) {
      conditions.push("c.status = $status");
      params.status = filters.status;
    }
    if (filters.type) {
      conditions.push("c.type = $type");
      params.type = filters.type;
    }
    if (filters.isLeaver !== undefined) {
      conditions.push("c.isLeaver = $isLeaver");
      params.isLeaver = filters.isLeaver === true;
    }

    if (conditions.length > 0) {
      query += " WHERE " + conditions.join(" AND ");
    }

    query += " RETURN c ORDER BY c.createdAt DESC";

    const result = await session.run(query, params);
    return result.records.map((r) => hydrateClaim(r.get("c").properties));
  } finally {
    await session.close();
  }
}

export async function getClaimById(id) {
  const connected = await ensureConnection();
  if (!connected) {
    const found = claims.find((c) => c.id === id) || null;
    return found ? hydrateClaim(found) : null;
  }

  const session = getSession();
  try {
    const result = await session.run(
      "MATCH (c:Claim {id: $id}) RETURN c",
      { id }
    );
    if (result.records.length === 0) return null;
    return hydrateClaim(result.records[0].get("c").properties);
  } finally {
    await session.close();
  }
}

export async function updateClaim(id, updates) {
  const connected = await ensureConnection();
  if (!connected) {
    const claim = claims.find((c) => c.id === id);
    if (!claim) return null;
    const setFields = [
      "status", "text", "confidence", "body", "author", "isLeaver", "sourceUrl", "sourceType",
      "sourceAuthority", "sourceProvider", "meetingId", "corroborated", "corroborationCount",
      "needsCorroboration", "type", "fileName", "fileId"
    ];
    for (const f of setFields) if (updates[f] !== undefined) claim[f] = updates[f];
    if (updates.proof !== undefined) claim.proof = updates.proof;
    if (updates.corroboratedBy !== undefined) claim.corroboratedBy = updates.corroboratedBy;
    if (updates.access !== undefined) claim.access = updates.access;
    claim.updatedAt = new Date().toISOString();
    return hydrateClaim(claim);
  }

  const session = getSession();
  try {
    const setClauses = [];
    const params = { id };
    const simpleFields = [
      "status", "text", "confidence", "body", "author", "isLeaver", "sourceUrl", "sourceType",
      "sourceAuthority", "sourceProvider", "meetingId", "corroborated", "corroborationCount",
      "needsCorroboration", "type", "fileName", "fileId"
    ];
    for (const f of simpleFields) {
      if (updates[f] !== undefined) {
        setClauses.push(`c.${f} = $${f}`);
        params[f] = updates[f];
      }
    }
    if (updates.proof !== undefined) {
      setClauses.push("c.proof = $proof");
      params.proof = typeof updates.proof === "string" ? updates.proof : JSON.stringify(updates.proof);
    }
    if (updates.corroboratedBy !== undefined) {
      setClauses.push("c.corroboratedBy = $corroboratedBy");
      params.corroboratedBy = typeof updates.corroboratedBy === "string" ? updates.corroboratedBy : JSON.stringify(updates.corroboratedBy);
    }
    if (updates.access !== undefined) {
      setClauses.push("c.access = $access");
      params.access = typeof updates.access === "string" ? updates.access : JSON.stringify(updates.access);
    }

    setClauses.push("c.updatedAt = $updatedAt");
    params.updatedAt = new Date().toISOString();

    const query = `MATCH (c:Claim {id: $id}) SET ${setClauses.join(", ")} RETURN c`;
    const result = await session.run(query, params);

    if (result.records.length === 0) return null;
    return hydrateClaim(result.records[0].get("c").properties);
  } finally {
    await session.close();
  }
}

export async function deleteClaim(id) {
  const connected = await ensureConnection();
  if (!connected) {
    const index = claims.findIndex((c) => c.id === id);
    if (index === -1) return false;
    claims.splice(index, 1);
    return true;
  }

  const session = getSession();
  try {
    const result = await session.run(
      "MATCH (c:Claim {id: $id}) DELETE c RETURN count(c) as deleted",
      { id }
    );
    return result.records[0].get("deleted").toNumber() > 0;
  } finally {
    await session.close();
  }
}

// --- Source Operations ---

function normalizeSourceForStorage(source) {
  const acl = source.acl;
  const aclString = acl == null ? null : typeof acl === "string" ? acl : JSON.stringify(acl);
  const metadata = source.metadata;
  const metadataString = metadata == null ? null : typeof metadata === "string" ? metadata : JSON.stringify(metadata);
  return {
    url: source.url,
    type: source.type || null,
    content: source.content || null,
    author: source.author || null,
    fileName: source.fileName || null,
    fileId: source.fileId || null,
    mimeType: source.mimeType || null,
    webViewLink: source.webViewLink || null,
    parents: Array.isArray(source.parents) ? source.parents : (source.parents ? [String(source.parents)] : []),
    driveId: source.driveId || null,
    ownerEmails: Array.isArray(source.ownerEmails) ? source.ownerEmails : (source.ownerEmails ? [String(source.ownerEmails)] : []),
    acl: aclString,
    aclFetchedAt: source.aclFetchedAt || null,
    provider: source.provider || null,
    meetingId: source.meetingId || null,
    sourceAuthority: source.sourceAuthority || null,
    occurredAt: source.occurredAt || null,
    metadata: metadataString,
    createdAt: source.createdAt || new Date().toISOString(),
  };
}

function hydrateSource(source) {
  if (!source) return source;
  const out = { ...source };
  if (typeof out.acl === "string") {
    try { out.acl = JSON.parse(out.acl); } catch { /* keep string */ }
  }
  if (typeof out.metadata === "string") {
    try { out.metadata = JSON.parse(out.metadata); } catch { /* keep string */ }
  }
  return out;
}

export async function createSource(source) {
  const normalized = normalizeSourceForStorage(source);
  const connected = await ensureConnection();
  if (!connected) {
    // upsert-like behavior in memory by url+fileId
    const idx = sources.findIndex((s) => s.url === normalized.url || (normalized.fileId && s.fileId === normalized.fileId));
    const hydrated = hydrateSource({ ...source, ...normalized, acl: source.acl ?? null, metadata: source.metadata ?? null });
    if (idx >= 0) sources[idx] = { ...sources[idx], ...hydrated };
    else sources.push(hydrated);
    return hydrated;
  }

  const session = getSession();
  try {
    const result = await session.run(
      `MERGE (s:Source {url: $url})
       SET s.type = $type,
           s.content = $content,
           s.author = $author,
           s.fileName = $fileName,
           s.fileId = $fileId,
           s.mimeType = $mimeType,
           s.webViewLink = $webViewLink,
           s.parents = $parents,
           s.driveId = $driveId,
           s.ownerEmails = $ownerEmails,
           s.acl = $acl,
           s.aclFetchedAt = $aclFetchedAt,
           s.provider = $provider,
           s.meetingId = $meetingId,
           s.sourceAuthority = $sourceAuthority,
           s.occurredAt = $occurredAt,
           s.metadata = $metadata,
           s.createdAt = coalesce(s.createdAt, $createdAt),
           s.updatedAt = datetime()
       RETURN s`,
      normalized
    );
    return hydrateSource(result.records[0].get("s").properties);
  } finally {
    await session.close();
  }
}

export async function getAllSources() {
  const connected = await ensureConnection();
  if (!connected) return sources.map(hydrateSource);

  const session = getSession();
  try {
    const result = await session.run("MATCH (s:Source) RETURN s ORDER BY coalesce(s.updatedAt, s.createdAt) DESC");
    return result.records.map((r) => hydrateSource(r.get("s").properties));
  } finally {
    await session.close();
  }
}

// --- Stats Operations ---

export async function getStats() {
  const connected = await ensureConnection();
  if (!connected) {
    return {
      totalClaims: claims.length,
      openCount: claims.filter((c) => c.status === "open").length,
      mergedCount: claims.filter((c) => c.status === "merged").length,
      closedCount: claims.filter((c) => c.status === "closed").length,
      leaverActivities: claims.filter((c) => c.isLeaver).length,
      claimTypes: [...new Set(claims.map((c) => c.type))],
    };
  }

  const session = getSession();
  try {
    const result = await session.run(`
      MATCH (c:Claim)
      RETURN
        count(c) as totalClaims,
        sum(CASE WHEN c.status = 'open' THEN 1 ELSE 0 END) as openCount,
        sum(CASE WHEN c.status = 'merged' THEN 1 ELSE 0 END) as mergedCount,
        sum(CASE WHEN c.status = 'closed' THEN 1 ELSE 0 END) as closedCount,
        sum(CASE WHEN c.isLeaver = true THEN 1 ELSE 0 END) as leaverActivities,
        collect(DISTINCT c.type) as claimTypes
    `);
    const record = result.records[0];
    return {
      totalClaims: record.get("totalClaims").toNumber(),
      openCount: record.get("openCount").toNumber(),
      mergedCount: record.get("mergedCount").toNumber(),
      closedCount: record.get("closedCount").toNumber(),
      leaverActivities: record.get("leaverActivities").toNumber(),
      claimTypes: record.get("claimTypes"),
    };
  } finally {
    await session.close();
  }
}

export async function getActionItems() {
  const connected = await ensureConnection();
  if (!connected) {
    return claims.filter(
      (c) =>
        c.status === "open" ||
        c.type === "open_pr" ||
        c.type === "open_issue" ||
        (c.type === "pr_review_comment" && c.isLeaver)
    );
  }

  const session = getSession();
  try {
    const result = await session.run(`
      MATCH (c:Claim)
      WHERE c.status = 'open'
         OR c.type = 'open_pr'
         OR c.type = 'open_issue'
         OR (c.type = 'pr_review_comment' AND c.isLeaver = true)
      RETURN c ORDER BY c.createdAt DESC
    `);
    return result.records.map((r) => r.get("c").properties);
  } finally {
    await session.close();
  }
}

export async function getLeaverActivity() {
  const connected = await ensureConnection();
  if (!connected) {
    const leaverClaims = claims.filter((c) => c.isLeaver);
    return {
      leaverUsername: leaverClaims.length > 0 ? leaverClaims[0].author : null,
      totalActivities: leaverClaims.length,
      activities: leaverClaims,
    };
  }

  const session = getSession();
  try {
    const result = await session.run(`
      MATCH (c:Claim {isLeaver: true})
      RETURN c ORDER BY c.createdAt DESC
    `);
    const activities = result.records.map((r) => r.get("c").properties);
    return {
      leaverUsername: activities.length > 0 ? activities[0].author : null,
      totalActivities: activities.length,
      activities,
    };
  } finally {
    await session.close();
  }
}

// --- Bulk Operations ---

export async function clearAllClaims() {
  const connected = await ensureConnection();
  if (!connected) {
    claims.length = 0;
    sources.length = 0;
    return;
  }

  const session = getSession();
  try {
    await session.run("MATCH (c:Claim) DELETE c");
    await session.run("MATCH (s:Source) DELETE s");
  } finally {
    await session.close();
  }
}

export async function bulkCreateClaims(claimsList) {
  const connected = await ensureConnection();
  if (!connected) {
    claimsList.forEach((c) => claims.push(c));
    return claimsList;
  }

  const session = getSession();
  try {
    const result = await session.run(
      `UNWIND $claims AS claim
       CREATE (c:Claim {
         id: claim.id,
         type: claim.type,
         text: claim.text,
         confidence: claim.confidence,
         status: claim.status,
         sourceUrl: claim.sourceUrl,
         sourceType: claim.sourceType,
         createdAt: claim.createdAt,
         updatedAt: claim.updatedAt,
         author: claim.author,
         isLeaver: claim.isLeaver,
         body: claim.body,
         labels: claim.labels,
         assignees: claim.assignees,
         reviewers: claim.reviewers,
         parentPr: claim.parentPr,
         parentPrTitle: claim.parentPrTitle,
         parentIssue: claim.parentIssue,
         parentIssueTitle: claim.parentIssueTitle,
         fileName: claim.fileName,
         fileId: claim.fileId
       })
       RETURN c`,
      { claims: claimsList }
    );
    return result.records.map((r) => r.get("c").properties);
  } finally {
    await session.close();
  }
}