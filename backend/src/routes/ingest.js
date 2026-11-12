import express from "express";
import fetch from "node-fetch";
import {
  createClaim,
  getAllClaims,
  getStats,
  getActionItems,
  getLeaverActivity,
  updateClaim,
  clearAllClaims,
} from "../services/neo4jService.js";
import { extractClaims, isLLMEnabled } from "../services/llm.js";
import { claims, sources, stats } from "../store.js";

const router = express.Router();
const GITHUB_BASE = "https://api.github.com";

function githubHeaders(token) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "baton-handover-app",
  };
  const resolvedToken = token || process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (resolvedToken) headers.Authorization = "Bearer " + resolvedToken;
  return headers;
}

async function readGitHubError(res) {
  const contentType = res.headers.get("content-type") || "";
  try {
    if (contentType.includes("application/json")) {
      const body = await res.json();
      return body.message || JSON.stringify(body).slice(0, 300);
    }
  } catch (e) {}
  try {
    const text = await res.text();
    return text.slice(0, 300);
  } catch (e) {
    return res.statusText || "Unknown GitHub API error";
  }
}

async function fetchAllPages(url, headers, perPage = 100) {
  const allItems = [];
  let page = 1;
  while (true) {
    const sep = url.includes("?") ? "&" : "?";
    const paginatedUrl = url + sep + "per_page=" + perPage + "&page=" + page;
    const res = await fetch(paginatedUrl, { headers });
    if (!res.ok) {
      const detail = await readGitHubError(res);
      const err = new Error(`GitHub API ${res.status} for ${paginatedUrl}: ${detail}`);
      err.status = res.status;
      err.detail = detail;
      err.url = paginatedUrl;
      err.page = page;
      throw err;
    }
    const items = await res.json();
    if (!Array.isArray(items) || items.length === 0) break;
    allItems.push(...items);
    const linkHeader = res.headers.get("link");
    if (!linkHeader || !linkHeader.includes('rel="next"')) break;
    page++;
    if (page > 10) break;
  }
  return allItems;
}

async function fetchComments(commentsUrl, headers) {
  if (!commentsUrl) return [];
  try {
    const res = await fetch(commentsUrl, { headers });
    if (!res.ok) {
      console.warn(`Failed to fetch comments ${commentsUrl}: ${res.status}`);
      return [];
    }
    const items = await res.json();
    return Array.isArray(items) ? items : [];
  } catch (e) {
    console.warn(`Error fetching comments ${commentsUrl}: ${e.message}`);
    return [];
  }
}

function mapExtractedCategory(category) {
  const map = {
    decisions: "decision",
    openQuestions: "question",
    tasks: "task",
    dependencies: "dependency",
    risks: "risk",
    contacts: "contact",
  };
  return map[category] || "insight";
}

async function enrichClaimsFromText({
  text,
  sourceType,
  sourceUrl,
  createdAt,
  updatedAt,
  author,
  isLeaver,
  parentPr = null,
  parentPrTitle = null,
  parentIssue = null,
  parentIssueTitle = null,
  responseClaims,
}) {
  if (!isLLMEnabled()) return;
  const content = typeof text === "string" ? text.trim() : "";
  if (content.length < 20) return;

  let extracted;
  try {
    extracted = await extractClaims(content, sourceType);
  } catch (e) {
    console.warn(`LLM extractClaims failed for ${sourceType} ${sourceUrl}: ${e.message}`);
    return;
  }

  for (const [category, items] of Object.entries(extracted || {})) {
    if (!Array.isArray(items) || items.length === 0) continue;
    const claimType = mapExtractedCategory(category);

    for (const item of items) {
      const claimText = typeof item === "string" ? item.trim() : String(item?.text || item || "").trim();
      if (!claimText) continue;

      const enrichedClaim = {
        id: `llm-${sourceType}-${responseClaims.length}-${Math.random().toString(36).slice(2, 7)}`,
        type: claimType,
        text: claimText,
        confidence: 0.7,
        status: "proposed",
        sourceUrl,
        sourceType,
        createdAt,
        updatedAt: updatedAt || createdAt,
        author: author || "unknown",
        isLeaver: Boolean(isLeaver),
        parentPr,
        parentPrTitle,
        parentIssue,
        parentIssueTitle,
        proof: {
          type: "llm_extracted_claim",
          category,
          sourceArtifactType: sourceType,
          sourceUrl,
          parentPr,
          parentIssue,
        },
      };

      await safeCreateClaim(enrichedClaim);
      responseClaims.push(enrichedClaim);
    }
  }
}

async function safeCreateClaim(claim) {
  try {
    const created = await createClaim(claim);
    // Keep in-memory mirror for response/debug visibility even when DB storage is used.
    if (!claims.find((c) => c.id === claim.id)) claims.push(claim);
    return created || claim;
  } catch (e) {
    if (!claims.find((c) => c.id === claim.id)) claims.push(claim);
    return claim;
  }
}

async function safeCreateSource(source) {
  if (!sources.find((s) => s.url === source.url && s.type === source.type)) {
    sources.push(source);
  }
  return source;
}

async function safeGetAllClaims(filters = {}) {
  try { return await getAllClaims(filters); } catch (e) {
    let filtered = claims;
    if (filters.status) filtered = filtered.filter((c) => c.status === filters.status);
    if (filters.type) filtered = filtered.filter((c) => c.type === filters.type);
    if (filters.isLeaver !== undefined) filtered = filtered.filter((c) => c.isLeaver === filters.isLeaver);
    return filtered;
  } }

async function safeGetStats() {
  try { return await getStats(); } catch (e) { return stats; } }

async function safeGetActionItems() {
  try { return await getActionItems(); } catch (e) {
    return claims.filter((c) =>
      c.status === "open" ||
      c.type === "open_pr" ||
      c.type === "open_issue" ||
      (c.type === "pr_review_comment" && c.isLeaver)
    );
  } }

async function safeGetLeaverActivity() {
  try { return await getLeaverActivity(); } catch (e) {
    const leaverClaims = claims.filter((c) => c.isLeaver);
    return {
      leaverUsername: leaverClaims.length > 0 ? leaverClaims[0].author : null,
      totalActivities: leaverClaims.length,
      activities: leaverClaims,
    };
  } }

async function safeUpdateClaim(id, updates) {
  try { return await updateClaim(id, updates); } catch (e) {
    const claim = claims.find((c) => c.id === id);
    if (!claim) return null;
    if (updates.status !== undefined) claim.status = updates.status;
    if (updates.text !== undefined) claim.text = updates.text;
    return claim;
  } }

router.post("/ingest/github", async (req, res) => {
  const { repo, leaverUsername, token } = req.body;
  if (!repo || typeof repo !== "string" || !/^[^/\s]+\/[^/\s]+$/.test(repo.trim())) {
    return res.status(400).json({ error: "repo is required in owner/repo format" });
  }

  const normalizedRepo = repo.trim();
  const normalizedLeaver = typeof leaverUsername === "string" && leaverUsername.trim() ? leaverUsername.trim() : null;
  const headers = githubHeaders(token);
  const responseClaims = [];

  try {
    claims.length = 0;
    sources.length = 0;
    Object.assign(stats, {
      totalPrs: 0, mergedPrs: 0, openPrs: 0, closedPrs: 0,
      totalIssues: 0, openIssues: 0, closedIssues: 0,
      totalComments: 0, leaverActivities: 0,
    });

    try { await clearAllClaims(); } catch (e) {
      console.warn("Failed to clear existing claims before ingest:", e.message);
    }

    const prs = await fetchAllPages(GITHUB_BASE + "/repos/" + normalizedRepo + "/pulls?state=all", headers);
    const issues = await fetchAllPages(GITHUB_BASE + "/repos/" + normalizedRepo + "/issues?state=all", headers);
    const pureIssues = issues.filter((i) => !i.pull_request);

    for (const pr of prs) {
      const isLeaver = normalizedLeaver ? pr.user.login === normalizedLeaver : false;
      const isMerged = pr.merged_at !== null;
      const isOpen = pr.state === "open";
      const isClosed = pr.state === "closed" && !isMerged;

      stats.totalPrs++;
      if (isMerged) stats.mergedPrs++;
      if (isOpen) stats.openPrs++;
      if (isClosed) stats.closedPrs++;
      if (isLeaver) stats.leaverActivities++;

      const prType = isMerged ? "merged_pr" : isOpen ? "open_pr" : "closed_pr";
      const prClaim = {
        id: "pr-" + pr.number + "-" + responseClaims.length,
        type: prType,
        text: pr.title || "(untitled PR)",
        confidence: 0.8,
        status: isMerged ? "merged" : isOpen ? "open" : "closed",
        sourceUrl: pr.html_url,
        sourceType: "pull_request",
        createdAt: pr.created_at,
        updatedAt: pr.updated_at,
        author: pr.user?.login || "unknown",
        isLeaver,
        body: pr.body || "",
        labels: Array.isArray(pr.labels) ? pr.labels.map((l) => l.name) : [],
        assignees: Array.isArray(pr.assignees) ? pr.assignees.map((a) => a.login) : [],
        reviewers: Array.isArray(pr.requested_reviewers) ? pr.requested_reviewers.map((r) => r.login) : [],
        proof: {
          type: "pull_request", number: pr.number, state: pr.state,
          merged: isMerged, url: pr.html_url, author: pr.user?.login || "unknown", isLeaver,
        },
      };
      await safeCreateClaim(prClaim);
      responseClaims.push(prClaim);
      await safeCreateSource({
        url: pr.html_url, type: "pull_request",
        content: (pr.title || "") + "\n" + (pr.body || ""), author: pr.user?.login || "unknown",
      });

      await enrichClaimsFromText({
        text: (pr.title || "") + "\n" + (pr.body || ""),
        sourceType: "pull_request",
        sourceUrl: pr.html_url,
        createdAt: pr.created_at,
        updatedAt: pr.updated_at,
        author: pr.user?.login || "unknown",
        isLeaver,
        parentPr: pr.number,
        parentPrTitle: pr.title,
        responseClaims,
      });

      const prComments = await fetchComments(pr.comments_url, headers);
      for (const comment of prComments) {
        const commentIsLeaver = normalizedLeaver ? comment.user?.login === normalizedLeaver : false;
        if (commentIsLeaver) stats.leaverActivities++;
        stats.totalComments++;
        const commentClaim = {
          id: "pr-comment-" + comment.id + "-" + responseClaims.length,
          type: "pr_comment", text: comment.body || "", confidence: 0.8, status: "commented",
          sourceUrl: comment.html_url || pr.html_url, sourceType: "pull_request_comment",
          createdAt: comment.created_at, author: comment.user?.login || "unknown", isLeaver: commentIsLeaver,
          parentPr: pr.number, parentPrTitle: pr.title,
          proof: {
            type: "pull_request_comment", commentId: comment.id, prNumber: pr.number,
            prTitle: pr.title, author: comment.user?.login || "unknown", isLeaver: commentIsLeaver,
            url: comment.html_url || pr.html_url,
          },
        };
        await safeCreateClaim(commentClaim);
        responseClaims.push(commentClaim);
        await safeCreateSource({
          url: comment.html_url || pr.html_url, type: "pull_request_comment",
          content: comment.body || "", author: comment.user?.login || "unknown", parentPr: pr.number,
        });
      }

      let reviewComments = [];
      try {
        reviewComments = await fetchAllPages(
          GITHUB_BASE + "/repos/" + normalizedRepo + "/pulls/" + pr.number + "/comments", headers);
      } catch (e) {
        console.warn(`Failed to fetch review comments for PR #${pr.number}: ${e.message}`);
      }
      for (const rc of reviewComments) {
        const rcIsLeaver = normalizedLeaver ? rc.user?.login === normalizedLeaver : false;
        if (rcIsLeaver) stats.leaverActivities++;
        stats.totalComments++;
        const rcClaim = {
          id: "pr-review-comment-" + rc.id + "-" + responseClaims.length,
          type: "pr_review_comment", text: rc.body || "", confidence: 0.8, status: "reviewed",
          sourceUrl: rc.html_url || pr.html_url, sourceType: "pull_request_review_comment",
          createdAt: rc.created_at, author: rc.user?.login || "unknown", isLeaver: rcIsLeaver,
          parentPr: pr.number, parentPrTitle: pr.title,
          proof: {
            type: "pull_request_review_comment", commentId: rc.id, prNumber: pr.number,
            prTitle: pr.title, author: rc.user?.login || "unknown", isLeaver: rcIsLeaver,
            url: rc.html_url || pr.html_url, path: rc.path, line: rc.line,
          },
        };
        await safeCreateClaim(rcClaim);
        responseClaims.push(rcClaim);
        await safeCreateSource({
          url: rc.html_url || pr.html_url, type: "pull_request_review_comment",
          content: rc.body || "", author: rc.user?.login || "unknown", parentPr: pr.number,
        });
      }
    }

    for (const issue of pureIssues) {
      const isLeaver = normalizedLeaver ? issue.user.login === normalizedLeaver : false;
      const isOpen = issue.state === "open";
      const isClosed = issue.state === "closed";

      stats.totalIssues++;
      if (isOpen) stats.openIssues++;
      if (isClosed) stats.closedIssues++;
      if (isLeaver) stats.leaverActivities++;

      const issueType = isOpen ? "open_issue" : "closed_issue";
      const issueClaim = {
        id: "issue-" + issue.number + "-" + responseClaims.length,
        type: issueType, text: issue.title || "(untitled issue)", confidence: 0.8,
        status: isOpen ? "open" : "closed", sourceUrl: issue.html_url,
        sourceType: "issue", createdAt: issue.created_at, updatedAt: issue.updated_at,
        author: issue.user?.login || "unknown", isLeaver, body: issue.body || "",
        labels: Array.isArray(issue.labels) ? issue.labels.map((l) => l.name) : [],
        assignees: Array.isArray(issue.assignees) ? issue.assignees.map((a) => a.login) : [],
        proof: {
          type: "issue", number: issue.number, state: issue.state,
          url: issue.html_url, author: issue.user?.login || "unknown", isLeaver,
        },
      };
      await safeCreateClaim(issueClaim);
      responseClaims.push(issueClaim);
      await safeCreateSource({
        url: issue.html_url, type: "issue",
        content: (issue.title || "") + "\n" + (issue.body || ""), author: issue.user?.login || "unknown",
      });

      await enrichClaimsFromText({
        text: (issue.title || "") + "\n" + (issue.body || ""),
        sourceType: "issue",
        sourceUrl: issue.html_url,
        createdAt: issue.created_at,
        updatedAt: issue.updated_at,
        author: issue.user?.login || "unknown",
        isLeaver,
        parentIssue: issue.number,
        parentIssueTitle: issue.title,
        responseClaims,
      });

      const issueComments = await fetchComments(issue.comments_url, headers);
      for (const comment of issueComments) {
        const commentIsLeaver = normalizedLeaver ? comment.user?.login === normalizedLeaver : false;
        if (commentIsLeaver) stats.leaverActivities++;
        stats.totalComments++;
        const issueCommentClaim = {
          id: "issue-comment-" + comment.id + "-" + responseClaims.length,
          type: "issue_comment", text: comment.body || "", confidence: 0.8, status: "commented",
          sourceUrl: comment.html_url || issue.html_url, sourceType: "issue_comment",
          createdAt: comment.created_at, author: comment.user?.login || "unknown", isLeaver: commentIsLeaver,
          parentIssue: issue.number, parentIssueTitle: issue.title,
          proof: {
            type: "issue_comment", commentId: comment.id, issueNumber: issue.number,
            issueTitle: issue.title, author: comment.user?.login || "unknown", isLeaver: commentIsLeaver,
            url: comment.html_url || issue.html_url,
          },
        };
        await safeCreateClaim(issueCommentClaim);
        responseClaims.push(issueCommentClaim);
        await safeCreateSource({
          url: comment.html_url || issue.html_url, type: "issue_comment",
          content: comment.body || "", author: comment.user?.login || "unknown", parentIssue: issue.number,
        });
      }
    }

    res.json({
      message: "Ingested " + prs.length + " PRs and " + pureIssues.length + " issues from " + normalizedRepo,
      repo: normalizedRepo,
      stats,
      claims: responseClaims.slice(0, 50),
      totalClaims: responseClaims.length,
      leaverUsername: normalizedLeaver,
      diagnostics: {
        prsFetched: prs.length,
        issuesFetched: issues.length,
        pureIssuesFetched: pureIssues.length,
        usedGitHubToken: Boolean(token || process.env.GITHUB_TOKEN || process.env.GH_TOKEN),
        llmEnrichmentEnabled: isLLMEnabled(),
      },
    });
  } catch (e) {
    console.error("GitHub ingestion failed:", e);
    res.status(e.status || 500).json({
      error: e.message || "GitHub ingestion failed",
      details: e.detail || null,
      url: e.url || null,
      diagnostics: {
        repo: normalizedRepo,
        usedGitHubToken: Boolean(token || process.env.GITHUB_TOKEN || process.env.GH_TOKEN),
      },
    });
  }
});

router.get("/claims", async (req, res) => {
  const { status, type, leaver } = req.query;
  const filters = {};
  if (status) filters.status = status;
  if (type) filters.type = type;
  if (leaver !== undefined) filters.isLeaver = leaver === "true";
  const claimsList = await safeGetAllClaims(filters);
  const statsResult = await safeGetStats();
  res.json({ claims: claimsList, total: claimsList.length, stats: statsResult });
});

router.get("/stats", async (req, res) => {
  const statsResult = await safeGetStats();
  res.json({ stats: statsResult });
});

router.get("/leaver-activity", async (req, res) => {
  const activity = await safeGetLeaverActivity();
  res.json(activity);
});

router.patch("/claims/:id", async (req, res) => {
  const { id } = req.params;
  const { status, text } = req.body;
  const claim = await safeUpdateClaim(id, { status, text });
  if (!claim) return res.status(404).json({ error: "Claim not found" });
  res.json(claim);
});

router.get("/action-items", async (req, res) => {
  const actionItems = await safeGetActionItems();
  res.json({ actionItems, count: actionItems.length });
});

export default router;
