import express from "express";
import fetch from "node-fetch";

const router = express.Router();

// In-memory storage for claims (no database needed for MVP)
let claims = [];
let sources = [];

// POST /api/ingest/github
// Body: { repo: "owner/repo", token?: "ghp_xxx" }
router.post("/ingest/github", async (req, res) => {
  const { repo, token } = req.body;
  if (!repo) {
    return res.status(400).json({ error: "repo is required (format: owner/repo)" });
  }

  const headers = { Accept: "application/vnd.github+json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const issuesRes = await fetch(`https://api.github.com/repos/${repo}/issues?state=open&per_page=20`, { headers });
    const issues = await issuesRes.json();

    const prsRes = await fetch(`https://api.github.com/repos/${repo}/pulls?state=open&per_page=20`, { headers });
    const prs = await prsRes.json();

    let saved = 0;

    for (const item of [...issues, ...prs]) {
      const sourceText = `${item.title}\n${item.body || ""}\n${item.html_url}`;
      const claimText = `Decided or discussed: ${item.title}`;
      const claimId = `claim-${Date.now()}-${saved}`;

      const claim = {
        id: claimId,
        type: item.pull_request ? "task" : "decision",
        text: claimText,
        confidence: 0.8,
        status: "proposed",
        sourceUrl: item.html_url,
        sourceType: item.pull_request ? "pull_request" : "issue",
        createdAt: new Date().toISOString(),
      };

      claims.push(claim);
      sources.push({
        url: item.html_url,
        type: item.pull_request ? "pull_request" : "issue",
        content: sourceText,
      });
      saved++;
    }

    res.json({
      message: `Ingested ${saved} items from ${repo}`,
      issues: issues.length,
      pullRequests: prs.length,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/claims
router.get("/claims", async (req, res) => {
  res.json({ claims });
});

// PATCH /api/claims/:id
router.patch("/claims/:id", async (req, res) => {
  const { id } = req.params;
  const { status, text } = req.body;
  const claim = claims.find(c => c.id === id);
  if (!claim) {
    return res.status(404).json({ error: "Claim not found" });
  }
  if (status) claim.status = status;
  if (text) claim.text = text;
  res.json(claim);
});

export default router;