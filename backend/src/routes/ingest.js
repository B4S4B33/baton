import express from "express";
import fetch from "node-fetch";
import { getSession } from "../db/neo4j.js";

const router = express.Router();

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

    const session = getSession();
    let saved = 0;

    for (const item of [...issues, ...prs]) {
      const sourceText = `${item.title}\n${item.body || ""}\n${item.html_url}`;
      const claimText = `Decided or discussed: ${item.title}`;

      try {
        await session.run(
          `MERGE (s:Source {url: $url})
           SET s.type = $type, s.contentHash = $hash, s.rawContent = $content, s.acl = $acl, s.ingestedAt = datetime()
           WITH s
           CREATE (c:Claim {
             id: randomUUID(),
             type: $claimType,
             text: $text,
             confidence: 0.8,
             status: 'proposed',
             createdAt: datetime()
           })
           CREATE (s)-[:HAS_CLAIM]->(c)
           CREATE (c)-[:EVIDENCE_FOR]->(s)`,
          {
            url: item.html_url,
            type: item.pull_request ? "pull_request" : "issue",
            hash: Buffer.from(sourceText).toString("base64").slice(0, 32),
            content: sourceText,
            acl: JSON.stringify({ repo, visibility: "public" }),
            claimType: item.pull_request ? "task" : "decision",
            text: claimText,
          }
        );
        saved++;
      } catch (e) {
        console.error("Failed to save item:", item.html_url, e.message);
      }
    }

    await session.close();

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
  const session = getSession();
  try {
    const result = await session.run(
      `MATCH (c:Claim)-[:EVIDENCE_FOR]->(s:Source)
       RETURN c.id AS id, c.type AS type, c.text AS text, c.confidence AS confidence, c.status AS status, s.url AS sourceUrl, s.type AS sourceType
       ORDER BY c.createdAt DESC`
    );
    const claims = result.records.map(r => ({
      id: r.get("id"),
      type: r.get("type"),
      text: r.get("text"),
      confidence: r.get("confidence"),
      status: r.get("status"),
      sourceUrl: r.get("sourceUrl"),
      sourceType: r.get("sourceType"),
    }));
    await session.close();
    res.json({ claims });
  } catch (e) {
    await session.close();
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/claims/:id
router.patch("/claims/:id", async (req, res) => {
  const { id } = req.params;
  const { status, text } = req.body;
  const session = getSession();
  try {
    const setClause = text ? "c.text = $text, " : "";
    const result = await session.run(
      `MATCH (c:Claim {id: $id})
       SET c.status = $status, ${setClause} c.updatedAt = datetime()
       RETURN c.id AS id, c.status AS status, c.text AS text`,
      { id, status, text }
    );
    await session.close();
    if (result.records.length === 0) {
      return res.status(404).json({ error: "Claim not found" });
    }
    res.json(result.records[0].toObject());
  } catch (e) {
    await session.close();
    res.status(500).json({ error: e.message });
  }
});

export default router;