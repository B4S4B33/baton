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
const GITHUB_TIMEOUT_MS = Number(process.env.GITHUB_TIMEOUT_MS) || 15000;
const GITHUB_MAX_PAGES = Number(process.env.GITHUB_MAX_PAGES) || 5;
const MAX_LLM_ENRICHMENTS = Number(process.env.MAX_LLM_ENRICHMENTS) || 20;
const LLM_ENRICHMENT_CONCURRENCY = Number(process.env.LLM_ENRICHMENT_CONCURRENCY) || 3;

function githubHeaders(token) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "baton-handover-app",
  };
  const resolvedToken = token || process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (resolvedToken) headers.Authorization = "Bearer " + resolvedToken;
  return headers;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = GITHUB_TIMEOUT_MS, label = "Request") {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (e) {
    if (e?.name === "AbortError") {
      const err = new Error(`${label} timed out after ${timeoutMs}ms: ${url}`);
      err.status = 504;
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
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

async function fetchAllPages(url, headers, perPage = 100, maxPages = GITHUB_MAX_PAGES) {
  const allItems = [];
  let page = 1;
  while (page <= maxPages) {
    const sep = url.includes("?") ? "&" : "?";
    const paginatedUrl = url + sep + "per_page=" + perPage + "&page=" + page;
    const res = await fetchWithTimeout(paginatedUrl, { headers }, GITHUB_TIMEOUT_MS, "GitHub API request");
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
  }
  return allItems;
}

async function fetchComments(commentsUrl, headers) {
  if (!commentsUrl) return [];
  try {
    const res = await fetchWithTimeout(commentsUrl, { headers }, GITHUB_TIMEOUT_MS, "GitHub comments request");
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
  counters,
}) {
  if (!isLLMEnabled()) return;
  if (counters && counters.llmEnrichmentAttempted >= MAX_LLM_ENRICHMENTS) {
    if (counters) counters.llmEnrichmentSkippedCap++;
    return;
  }

  const content = typeof text === "string" ? text.trim() : "";
  if (content.length < 20) return;

  if (counters) counters.llmEnrichmentAttempted++;

  let extracted;
  try {
    extracted = await extractClaims(content, sourceType);
  } catch (e) {
    if (counters) counters.llmEnrichmentErrors++;
    console.warn(`LLM extractClaims failed for ${sourceType} ${sourceUrl}: ${e.message}`);
    return;
  }

  let added = 0;
  for (const [category, items] of Object.entries(extracted || {})) {
    if (!Array.isArray(items) || items.length === 0) continue;
    const claimType = mapExtractedCategory(category);

    for (const item of items) {
      const claimText = typeof item === "string" ? item.trim() : String(item?.text || item || "").trim();
      if (!claimText) continue;

      const enrichedClaim = {
        id: `llm-${sourceType}-${Date.now()}-${responseClaims.length}-${Math.random().toString(36).slice(2, 7)}`,
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
      added++;
    }
  }

  if (counters && added > 0) counters.llmClaimsCreated += added;
}

async function runWithConcurrency(tasks, concurrency = LLM_ENRICHMENT_CONCURRENCY) {
  const results = [];
  let index = 0;
  async function worker() {
    while (index < tasks.length) {
      const i = index++;
      try {
        results[i] = await tasks[i]();
      } catch (e) {
        results[i] = { error: e };
      }
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, tasks.length || 1) }, () => worker());
  await Promise.all(workers);
  return results;
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
  const startedAt = Date.now();
  const { repo, leaverUsername, token } = req.body || {};
  if (!repo || typeof repo !== "string" || !/^[^/\s]+\/[^/\s]+$/.test(repo.trim())) {
    return res.status(400).json({ error: "repo is required in owner/repo format" });
  }

  const normalizedRepo = repo.trim();
  const normalizedLeaver = typeof leaverUsername === "string" && leaverUsername.trim() ? leaverUsername.trim() : null;
  const headers = githubHeaders(token);
  const responseClaims = [];
  const enrichmentTasks = [];
  const enrichmentCounters = {
    llmEnrichmentAttempted: 0,
    llmEnrichmentErrors: 0,
    llmClaimsCreated: 0,
    llmEnrichmentSkippedCap: 0,
  };
  const fetchWarnings = [];

  try {
    console.log(`[ingest/github] start repo=${normalizedRepo} leaver=${normalizedLeaver || "-"} llm=${isLLMEnabled()} token=${Boolean(token || process.env.GITHUB_TOKEN || process.env.GH_TOKEN)}`);
    claims.length = 0;
    sources.length = 0;
    Object.assign(stats, {
      totalPrs: 0, mergedPrs: 0, openPrs: 0, closedPrs: 0,
      totalIssues: 0, openIssues: 0, closedIssues: 0,
      totalComments: 0, leaverActivities: 0,
    });

    try { await clearAllClaims(); } catch (e) {
      console.warn("Failed to clear existing claims before ingest:", e.message);
      fetchWarnings.push(`clearAllClaims: ${e.message}`);
    }

    const prs = await fetchAllPages(GITHUB_BASE + "/repos/" + normalizedRepo + "/pulls?state=all", headers);
    const issues = await fetchAllPages(GITHUB_BASE + "/repos/" + normalizedRepo + "/issues?state=all", headers);
    const pureIssues = issues.filter((i) => !i.pull_request);
    console.log(`[ingest/github] fetched repo=${normalizedRepo} prs=${prs.length} issues=${issues.length} pureIssues=${pureIssues.length}`);

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

      if (isLLMEnabled() && enrichmentTasks.length < MAX_LLM_ENRICHMENTS) {
        enrichmentTasks.push(() => enrichClaimsFromText({
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
          counters: enrichmentCounters,
        }));
      }

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
          GITHUB_BASE + "/repos/" + normalizedRepo + "/pulls/" + pr.number + "/comments", headers, 100, 3);
      } catch (e) {
        console.warn(`Failed to fetch review comments for PR #${pr.number}: ${e.message}`);
        fetchWarnings.push(`PR #${pr.number} review comments: ${e.message}`);
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

      if (isLLMEnabled() && enrichmentTasks.length < MAX_LLM_ENRICHMENTS) {
        enrichmentTasks.push(() => enrichClaimsFromText({
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
          counters: enrichmentCounters,
        }));
      }

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

    if (enrichmentTasks.length > 0) {
      console.log(`[ingest/github] running LLM enrichment repo=${normalizedRepo} tasks=${enrichmentTasks.length} concurrency=${LLM_ENRICHMENT_CONCURRENCY}`);
      await runWithConcurrency(enrichmentTasks, LLM_ENRICHMENT_CONCURRENCY);
    }

    const diagnostics = {
      prsFetched: prs.length,
      issuesFetched: issues.length,
      pureIssuesFetched: pureIssues.length,
      usedGitHubToken: Boolean(token || process.env.GITHUB_TOKEN || process.env.GH_TOKEN),
      llmEnrichmentEnabled: isLLMEnabled(),
      llmTasksQueued: enrichmentTasks.length,
      llmEnrichmentAttempted: enrichmentCounters.llmEnrichmentAttempted,
      llmEnrichmentErrors: enrichmentCounters.llmEnrichmentErrors,
      llmClaimsCreated: enrichmentCounters.llmClaimsCreated,
      llmEnrichmentSkippedCap: Math.max(0, (enrichmentTasks.length + (prs.length + pureIssues.length - enrichmentTasks.length)) - MAX_LLM_ENRICHMENTS),
      durationMs: Date.now() - startedAt,
      warnings: fetchWarnings.slice(0, 20),
    };
    console.log(`[ingest/github] done repo=${normalizedRepo} claims=${responseClaims.length} durationMs=${diagnostics.durationMs}`);

    res.json({
      message: "Ingested " + prs.length + " PRs and " + pureIssues.length + " issues from " + normalizedRepo,
      repo: normalizedRepo,
      stats,
      claims: responseClaims.slice(0, 50),
      totalClaims: responseClaims.length,
      leaverUsername: normalizedLeaver,
      diagnostics,
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
        llmEnrichmentEnabled: isLLMEnabled(),
        durationMs: Date.now() - startedAt,
        warnings: fetchWarnings.slice(0, 20),
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

router.post("/clear", async (req, res) => {
  try {
    claims.length = 0;
    sources.length = 0;
    Object.assign(stats, {
      totalPrs: 0, mergedPrs: 0, openPrs: 0, closedPrs: 0,
      totalIssues: 0, openIssues: 0, closedIssues: 0,
      totalComments: 0, leaverActivities: 0,
    });
    await clearAllClaims();
    res.json({ ok: true, message: "All claims and sources cleared" });
  } catch (e) {
    console.error("Clear failed:", e);
    res.status(500).json({ error: e.message || "Failed to clear data" });
  }
});

router.post("/demo-data", async (req, res) => {
  try {
    claims.length = 0;
    sources.length = 0;
    Object.assign(stats, {
      totalPrs: 0, mergedPrs: 0, openPrs: 0, closedPrs: 0,
      totalIssues: 0, openIssues: 0, closedIssues: 0,
      totalComments: 0, leaverActivities: 0,
    });
    await clearAllClaims();

    const now = new Date().toISOString();
    const leaver = "alex-dev";
    const demoClaims = [
      {
        id: "demo-pr-42",
        type: "merged_pr",
        text: "Refactor authentication service to use OAuth2 instead of JWT",
        confidence: 0.9,
        status: "merged",
        sourceUrl: "https://github.com/owner/repo/pull/42",
        sourceType: "pull_request",
        createdAt: now,
        updatedAt: now,
        author: "sarah-pm",
        isLeaver: false,
        body: "This PR replaces the custom JWT auth with OAuth2 flow. All login endpoints updated.",
        labels: ["enhancement", "auth"],
        assignees: ["sarah-pm"],
        reviewers: ["alex-dev"],
        proof: { type: "pull_request", number: 42, state: "merged", url: "https://github.com/owner/repo/pull/42", author: "sarah-pm", isLeaver: false },
      },
      {
        id: "demo-pr-87",
        type: "open_pr",
        text: "Add rate limiting to API endpoints",
        confidence: 0.85,
        status: "open",
        sourceUrl: "https://github.com/owner/repo/pull/87",
        sourceType: "pull_request",
        createdAt: now,
        updatedAt: now,
        author: leaver,
        isLeaver: true,
        body: "Implement Redis-based rate limiting on all public API routes.",
        labels: ["enhancement", "security"],
        assignees: [leaver],
        reviewers: ["mike-dev"],
        proof: { type: "pull_request", number: 87, state: "open", url: "https://github.com/owner/repo/pull/87", author: leaver, isLeaver: true },
      },
      {
        id: "demo-issue-15",
        type: "open_issue",
        text: "Database connection pool exhaustion under load",
        confidence: 0.9,
        status: "open",
        sourceUrl: "https://github.com/owner/repo/issues/15",
        sourceType: "issue",
        createdAt: now,
        updatedAt: now,
        author: "ops-team",
        isLeaver: false,
        body: "PostgreSQL pool hits max connections during peak traffic. Need to increase pool size or add connection recycling.",
        labels: ["bug", "database", "high-priority"],
        assignees: ["ops-team"],
        proof: { type: "issue", number: 15, state: "open", url: "https://github.com/owner/repo/issues/15", author: "ops-team", isLeaver: false },
      },
      {
        id: "demo-decision-1",
        type: "decision",
        text: "Adopt PostgreSQL as primary database, deprecate MongoDB",
        confidence: 0.95,
        status: "accepted",
        sourceUrl: "https://github.com/owner/repo/pull/31",
        sourceType: "pull_request",
        createdAt: now,
        updatedAt: now,
        author: "cto",
        isLeaver: false,
        body: "Architecture decision: migrate all services to PostgreSQL. MongoDB to be decommissioned by Q3.",
        labels: ["architecture", "decision"],
        assignees: [],
        reviewers: ["cto", "sarah-pm"],
        proof: { type: "architecture_decision", source: "pull_request", url: "https://github.com/owner/repo/pull/31" },
      },
      {
        id: "demo-task-1",
        type: "task",
        text: "Update API documentation for v2 endpoints",
        confidence: 0.8,
        status: "open",
        sourceUrl: "https://github.com/owner/repo/issues/23",
        sourceType: "issue",
        createdAt: now,
        updatedAt: now,
        author: "tech-writer",
        isLeaver: false,
        body: "Document all v2 API endpoints including request/response schemas and examples.",
        labels: ["documentation"],
        assignees: ["tech-writer"],
        proof: { type: "issue", number: 23, state: "open", url: "https://github.com/owner/repo/issues/23", author: "tech-writer", isLeaver: false },
      },
      {
        id: "demo-risk-1",
        type: "risk",
        text: "Third-party payment API may exceed rate limits during holiday season",
        confidence: 0.7,
        status: "open",
        sourceUrl: "https://github.com/owner/repo/issues/44",
        sourceType: "issue",
        createdAt: now,
        updatedAt: now,
        author: "sarah-pm",
        isLeaver: false,
        body: "Stripe API rate limit of 100 req/sec may be exceeded during Black Friday traffic. Consider implementing request queuing.",
        labels: ["risk", "payment", "external"],
        assignees: ["backend-team"],
        proof: { type: "issue", number: 44, state: "open", url: "https://github.com/owner/repo/issues/44", author: "sarah-pm", isLeaver: false },
      },
      {
        id: "demo-meeting-1",
        type: "decision",
        text: "Switch from Slack to Microsoft Teams for team communication",
        confidence: 0.6,
        status: "proposed",
        sourceUrl: "https://meet.example.com/team-sync-2026-11-01",
        sourceType: "meeting_summary",
        sourceProvider: "zoom",
        meetingId: "zoom-12345",
        sourceAuthority: "low",
        corroborated: false,
        corroborationCount: 0,
        needsCorroboration: true,
        createdAt: now,
        updatedAt: now,
        author: "sarah-pm",
        isLeaver: false,
        body: "Team agreed to evaluate Microsoft Teams as replacement for Slack. Trial period of 2 weeks starting next month.",
        proof: { type: "meeting_summary", sourceArtifactType: "meeting_summary", sourceUrl: "https://meet.example.com/team-sync-2026-11-01", meetingId: "zoom-12345" },
      },
      {
        id: "demo-meeting-2",
        type: "task",
        text: "Create onboarding checklist for new hires",
        confidence: 0.65,
        status: "proposed",
        sourceUrl: "https://meet.example.com/onboarding-plan-2026-10-15",
        sourceType: "meeting_summary",
        sourceProvider: "google_meet",
        meetingId: "gm-67890",
        sourceAuthority: "low",
        corroborated: true,
        corroborationCount: 1,
        needsCorroboration: false,
        createdAt: now,
        updatedAt: now,
        author: "hr-lead",
        isLeaver: false,
        body: "HR to create a comprehensive onboarding checklist including equipment, access, and training materials.",
        proof: { type: "meeting_summary", sourceArtifactType: "meeting_summary", sourceUrl: "https://meet.example.com/onboarding-plan-2026-10-15", meetingId: "gm-67890" },
      },
      {
        id: "demo-redacted-1",
        type: "pr_comment",
        text: "The database password is admin123 and the API key is sk-live_xyz789",
        confidence: 0.8,
        status: "commented",
        sourceUrl: "https://github.com/owner/repo/pull/42#discussion_r100",
        sourceType: "pull_request_comment",
        createdAt: now,
        updatedAt: now,
        author: leaver,
        isLeaver: true,
        body: "Shared credentials in PR comment - should be removed.",
        labels: [],
        assignees: [],
        reviewers: [],
        proof: { type: "pull_request_comment", commentId: "r100", prNumber: 42, author: leaver, isLeaver: true },
      },
      {
        id: "demo-closed-issue-1",
        type: "closed_issue",
        text: "Fix broken image links in user profile pages",
        confidence: 0.85,
        status: "closed",
        sourceUrl: "https://github.com/owner/repo/issues/56",
        sourceType: "issue",
        createdAt: now,
        updatedAt: now,
        author: "frontend-team",
        isLeaver: false,
        body: "User profile images return 404 due to incorrect CDN path. Fixed by updating image URL prefix.",
        labels: ["bug", "frontend"],
        assignees: ["frontend-team"],
        proof: { type: "issue", number: 56, state: "closed", url: "https://github.com/owner/repo/issues/56", author: "frontend-team", isLeaver: false },
      },
    ];

    const demoSources = [
      { url: "https://github.com/owner/repo/pull/42", type: "pull_request", content: "Refactor authentication service to use OAuth2 instead of JWT", author: "sarah-pm" },
      { url: "https://github.com/owner/repo/pull/87", type: "pull_request", content: "Add rate limiting to API endpoints", author: leaver },
      { url: "https://github.com/owner/repo/issues/15", type: "issue", content: "Database connection pool exhaustion under load", author: "ops-team" },
      { url: "https://github.com/owner/repo/pull/31", type: "pull_request", content: "Adopt PostgreSQL as primary database, deprecate MongoDB", author: "cto" },
      { url: "https://github.com/owner/repo/issues/23", type: "issue", content: "Update API documentation for v2 endpoints", author: "tech-writer" },
      { url: "https://github.com/owner/repo/issues/44", type: "issue", content: "Third-party payment API may exceed rate limits during holiday season", author: "sarah-pm" },
      { url: "https://meet.example.com/team-sync-2026-11-01", type: "meeting_summary", content: "Switch from Slack to Microsoft Teams for team communication", author: "sarah-pm", provider: "zoom", meetingId: "zoom-12345", sourceAuthority: "low", occurredAt: now },
      { url: "https://meet.example.com/onboarding-plan-2026-10-15", type: "meeting_summary", content: "Create onboarding checklist for new hires", author: "hr-lead", provider: "google_meet", meetingId: "gm-67890", sourceAuthority: "low", occurredAt: now },
    ];

    for (const claim of demoClaims) {
      await createClaim(claim);
      if (!claims.find((c) => c.id === claim.id)) claims.push(claim);
    }
    for (const source of demoSources) {
      await createSource(source);
    }

    // Recompute stats from claims
    const allClaims = await getAllClaims();
    Object.assign(stats, {
      totalPrs: allClaims.filter((c) => c.type.includes("pr")).length,
      mergedPrs: allClaims.filter((c) => c.type === "merged_pr").length,
      openPrs: allClaims.filter((c) => c.type === "open_pr").length,
      closedPrs: allClaims.filter((c) => c.type === "closed_pr").length,
      totalIssues: allClaims.filter((c) => c.type.includes("issue")).length,
      openIssues: allClaims.filter((c) => c.type === "open_issue").length,
      closedIssues: allClaims.filter((c) => c.type === "closed_issue").length,
      totalComments: allClaims.filter((c) => c.type.includes("comment")).length,
      leaverActivities: allClaims.filter((c) => c.isLeaver).length,
    });

    res.json({
      ok: true,
      message: "Demo data seeded successfully",
      claimsCreated: demoClaims.length,
      sourcesCreated: demoSources.length,
      stats,
    });
  } catch (e) {
    console.error("Demo data seed failed:", e);
    res.status(500).json({ error: e.message || "Failed to seed demo data" });
  }
});

export default router;
