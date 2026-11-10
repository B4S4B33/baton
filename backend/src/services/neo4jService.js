import { getSession, closeDriver } from "../db/neo4j.js";
import { claims, sources, stats } from "../store.js";

/**
 * Neo4j Service - Graph database operations for claims, sources, and stats
 * Falls back gracefully to in-memory storage when Neo4j is unavailable
 */

let neo4jConnected = false;
let connectionAttempted = false;

async function ensureConnection() {
  if (neo4jConnected) return true;
  if (connectionAttempted && !neo4jConnected) return false;

  connectionAttempted = true;
  try {
    const session = getSession();
    await session.run("RETURN 1");
    await session.close();
    neo4jConnected = true;
    console.log("Neo4j connected successfully");
    return true;
  } catch (e) {
    console.warn("Neo4j not available, using in-memory storage:", e.message);
    neo4jConnected = false;
    return false;
  }
}

// --- Claim Operations ---

export async function createClaim(claim) {
  const connected = await ensureConnection();
  if (!connected) {
    claims.push(claim);
    return claim;
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
        fileId: $fileId
      })
      RETURN c`,
      {
        id: claim.id,
        type: claim.type,
        text: claim.text,
        confidence: claim.confidence ?? 0.5,
        status: claim.status,
        sourceUrl: claim.sourceUrl,
        sourceType: claim.sourceType,
        createdAt: claim.createdAt,
        updatedAt: claim.updatedAt || claim.createdAt,
        author: claim.author || null,
        isLeaver: claim.isLeaver ?? false,
        body: claim.body || null,
        labels: claim.labels || [],
        assignees: claim.assignees || [],
        reviewers: claim.reviewers || [],
        parentPr: claim.parentPr || null,
        parentPrTitle: claim.parentPrTitle || null,
        parentIssue: claim.parentIssue || null,
        parentIssueTitle: claim.parentIssueTitle || null,
        fileName: claim.fileName || null,
        fileId: claim.fileId || null,
      }
    );
    return result.records[0].get("c").properties;
  } finally {
    await session.close();
  }
}

export async function getAllClaims(filters = {}) {
  const connected = await ensureConnection();
  if (!connected) {
    let filtered = claims;
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
    return result.records.map((r) => r.get("c").properties);
  } finally {
    await session.close();
  }
}

export async function getClaimById(id) {
  const connected = await ensureConnection();
  if (!connected) {
    return claims.find((c) => c.id === id) || null;
  }

  const session = getSession();
  try {
    const result = await session.run(
      "MATCH (c:Claim {id: $id}) RETURN c",
      { id }
    );
    if (result.records.length === 0) return null;
    return result.records[0].get("c").properties;
  } finally {
    await session.close();
  }
}

export async function updateClaim(id, updates) {
  const connected = await ensureConnection();
  if (!connected) {
    const claim = claims.find((c) => c.id === id);
    if (!claim) return null;
    if (updates.status !== undefined) claim.status = updates.status;
    if (updates.text !== undefined) claim.text = updates.text;
    if (updates.confidence !== undefined) claim.confidence = updates.confidence;
    return claim;
  }

  const session = getSession();
  try {
    const setClauses = [];
    const params = { id };

    if (updates.status !== undefined) {
      setClauses.push("c.status = $status");
      params.status = updates.status;
    }
    if (updates.text !== undefined) {
      setClauses.push("c.text = $text");
      params.text = updates.text;
    }
    if (updates.confidence !== undefined) {
      setClauses.push("c.confidence = $confidence");
      params.confidence = updates.confidence;
    }

    setClauses.push("c.updatedAt = $updatedAt");
    params.updatedAt = new Date().toISOString();

    const query = `MATCH (c:Claim {id: $id}) SET ${setClauses.join(", ")} RETURN c`;
    const result = await session.run(query, params);

    if (result.records.length === 0) return null;
    return result.records[0].get("c").properties;
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

export async function createSource(source) {
  const connected = await ensureConnection();
  if (!connected) {
    sources.push(source);
    return source;
  }

  const session = getSession();
  try {
    const result = await session.run(
      `CREATE (s:Source {
        url: $url,
        type: $type,
        content: $content,
        author: $author,
        fileName: $fileName,
        fileId: $fileId,
        createdAt: datetime()
      })
      RETURN s`,
      {
        url: source.url,
        type: source.type,
        content: source.content || null,
        author: source.author || null,
        fileName: source.fileName || null,
        fileId: source.fileId || null,
      }
    );
    return result.records[0].get("s").properties;
  } finally {
    await session.close();
  }
}

export async function getAllSources() {
  const connected = await ensureConnection();
  if (!connected) return sources;

  const session = getSession();
  try {
    const result = await session.run("MATCH (s:Source) RETURN s ORDER BY s.createdAt DESC");
    return result.records.map((r) => r.get("s").properties);
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