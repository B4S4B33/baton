import express from "express";
import fetch from "node-fetch";
import {
  createClaim,
  createSource,
  getAllClaims,
  getStats,
  getActionItems,
  getLeaverActivity,
  updateClaim,
  clearAllClaims,
  bulkCreateClaims,
} from "../services/neo4jService.js";
import { claims, sources, stats } from "../store.js";
const router = express.Router();
const GITHUB_BASE = "https://api.github.com";

async function fetchAllPages(url, headers, perPage = 100) {
  const allItems = [];
  let page = 1;
  while (true) {
    const sep = url.includes("?") ? "&" : "?";
    const paginatedUrl = url + sep + "per_page=" + perPage + "&page=" + page;
    const res = await fetch(paginatedUrl, { headers });
    if (!res.ok) break;
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
  const res = await fetch(commentsUrl, { headers });
  if (!res.ok) return [];
  return await res.json();
}

async function safeCreateClaim(claim) {
  try { return await createClaim(claim); } catch (e) { claims.push(claim); return claim; } }

async function safeCreateSource(source) {
  try { return await createSource(source); } catch (e) { sources.push(source); return source; } }

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
  if (!repo) {
    return res.status(400).json({ error: "repo is required (format: owner/repo)" });
  }
  const headers = { Accept: "application/vnd.github+json" };
  if (token) headers.Authorization = "Bearer " + token;
  try {
    claims.length = 0;
    sources.length = 0;
    Object.assign(stats, {
      totalPrs: 0, mergedPrs: 0, openPrs: 0, closedPrs: 0,
      totalIssues: 0, openIssues: 0, closedIssues: 0,
      totalComments: 0, leaverActivities: 0,
    });
    try { await clearAllClaims(); } catch (e) {}
    const prs = await fetchAllPages(GITHUB_BASE + "/repos/" + repo + "/pulls?state=all", headers);
    const issues = await fetchAllPages(GITHUB_BASE + "/repos/" + repo + "/issues?state=all", headers);
    const pureIssues = issues.filter((i) => !i.pull_request);
    for (const pr of prs) {
      const isLeaver = pr.user.login === leaverUsername;
      const isMerged = pr.merged_at !== null;
      const isOpen = pr.state === "open";
      const isClosed = pr.state === "closed" && !isMerged;
      stats.totalPrs++;
      if (isMerged) stats.mergedPrs++;
      if (isOpen) stats.openPrs++;
      if (isClosed) stats.closedPrs++;
      if (isLeaver) stats.leaverActivities++;
      const prType = isMerged ? "merged_pr" : isOpen ? "open_pr" : "closed_pr";
      await safeCreateClaim({
        id: "pr-" + pr.number + "-" + claims.length,
        type: prType,
        text: pr.title,
        confidence: 0.8,
        status: isMerged ? "merged" : isOpen ? "open" : "closed",
        sourceUrl: pr.html_url,
        sourceType: "pull_request",
        createdAt: pr.created_at,
        updatedAt: pr.updated_at,
        author: pr.user.login,
        isLeaver: isLeaver,
        body: pr.body || "",
        labels: pr.labels.map((l) => l.name),
        assignees: pr.assignees.map((a) => a.login),
        reviewers: pr.requested_reviewers.map((r) => r.login),
        proof: {
          type: "pull_request", number: pr.number, state: pr.state,
          merged: isMerged, url: pr.html_url, author: pr.user.login, isLeaver: isLeaver,
        },
      });
      sources.push({
        url: pr.html_url, type: "pull_request",
        content: pr.title + "\n" + (pr.body || ""), author: pr.user.login,
      });
      const prComments = await fetchComments(pr.comments_url, headers);
      for (const comment of prComments) {
        const commentIsLeaver = comment.user.login === leaverUsername;
        if (commentIsLeaver) stats.leaverActivities++;
        stats.totalComments++;
        await safeCreateClaim({
          id: "pr-comment-" + comment.id + "-" + claims.length,
          type: "pr_comment", text: comment.body || "", confidence: 0.8, status: "commented",
          sourceUrl: comment.html_url || pr.html_url, sourceType: "pull_request_comment",
          createdAt: comment.created_at, author: comment.user.login, isLeaver: commentIsLeaver,
          parentPr: pr.number, parentPrTitle: pr.title,
          proof: { type: "pull_request_comment", commentId: comment.id, prNumber: pr.number,
            prTitle: pr.title, author: comment.user.login, isLeaver: commentIsLeaver,
            url: comment.html_url || pr.html_url },
        });
        sources.push({ url: comment.html_url || pr.html_url, type: "pull_request_comment",
          content: comment.body || "", author: comment.user.login, parentPr: pr.number });
      }
      const reviewComments = await fetchAllPages(
        GITHUB_BASE + "/repos/" + repo + "/pulls/" + pr.number + "/comments", headers);
      for (const rc of reviewComments) {
        const rcIsLeaver = rc.user.login === leaverUsername;
        if (rcIsLeaver) stats.leaverActivities++;
        stats.totalComments++;
        await safeCreateClaim({
          id: "pr-review-comment-" + rc.id + "-" + claims.length,
          type: "pr_review_comment", text: rc.body || "", confidence: 0.8, status: "reviewed",
          sourceUrl: rc.html_url || pr.html_url, sourceType: "pull_request_review_comment",
          createdAt: rc.created_at, author: rc.user.login, isLeaver: rcIsLeaver,
          parentPr: pr.number, parentPrTitle: pr.title,
          proof: { type: "pull_request_review_comment", commentId: rc.id, prNumber: pr.number,
            prTitle: pr.title, author: rc.user.login, isLeaver: rcIsLeaver,
            url: rc.html_url || pr.html_url, path: rc.path, line: rc.line },
        });
        sources.push({ url: rc.html_url || pr.html_url, type: "pull_request_review_comment",
          content: rc.body || "", author: rc.user.login, parentPr: pr.number });
      }
    }
    for (const issue of pureIssues) {
      const isLeaver = issue.user.login === leaverUsername;
      const isOpen = issue.state === "open";
      const isClosed = issue.state === "closed";
      stats.totalIssues++;
      if (isOpen) stats.openIssues++;
      if (isClosed) stats.closedIssues++;
      if (isLeaver) stats.leaverActivities++;
      const issueType = isOpen ? "open_issue" : "closed_issue";
      await safeCreateClaim({
        id: "issue-" + issue.number + "-" + claims.length,
        type: issueType, text: issue.title, confidence: 0.8,
        status: isOpen ? "open" : "closed", sourceUrl: issue.html_url,
        sourceType: "issue", createdAt: issue.created_at, updatedAt: issue.updated_at,
        author: issue.user.login, isLeaver: isLeaver, body: issue.body || "",
        labels: issue.labels.map((l) => l.name), assignees: issue.assignees.map((a) => a.login),
        proof: { type: "issue", number: issue.number, state: issue.state,
          url: issue.html_url, author: issue.user.login, isLeaver: isLeaver },
      });
      sources.push({ url: issue.html_url, type: "issue",
        content: issue.title + "\n" + (issue.body || ""), author: issue.user.login });
      const issueComments = await fetchComments(issue.comments_url, headers);
      for (const comment of issueComments) {
        const commentIsLeaver = comment.user.login === leaverUsername;
        if (commentIsLeaver) stats.leaverActivities++;
        stats.totalComments++;
        await safeCreateClaim({
          id: "issue-comment-" + comment.id + "-" + claims.length,
          type: "issue_comment", text: comment.body || "", confidence: 0.8, status: "commented",
          sourceUrl: comment.html_url || issue.html_url, sourceType: "issue_comment",
          createdAt: comment.created_at, author: comment.user.login, isLeaver: commentIsLeaver,
          parentIssue: issue.number, parentIssueTitle: issue.title,
          proof: { type: "issue_comment", commentId: comment.id, issueNumber: issue.number,
            issueTitle: issue.title, author: comment.user.login, isLeaver: commentIsLeaver,
            url: comment.html_url || issue.html_url },
        });
        sources.push({ url: comment.html_url || issue.html_url, type: "issue_comment",
          content: comment.body || "", author: comment.user.login, parentIssue: issue.number });
      }
    }
    res.json({
      message: "Ingested " + prs.length + " PRs and " + pureIssues.length + " issues from " + repo,
      stats, claims: claims.slice(0, 50), totalClaims: claims.length,
      leaverUsername: leaverUsername || null,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  } }

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
