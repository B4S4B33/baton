import express from "express";
import { execFileSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");

function git(args, opts = {}) {
  try {
    return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", ...opts }).trim();
  } catch (e) {
    return "";
  }
}

function extractPrRef(text) {
  if (!text) return null;
  const prMatch = String(text).match(/#(\d+)/);
  return prMatch ? `PR #${prMatch[1]}` : null;
}

function parseCommits(logRaw) {
  if (!logRaw) return [];
  return logRaw.split("\n").filter(Boolean).map((line) => {
    const [hash, subject, ...bodyParts] = line.split("\t");
    const body = bodyParts.join("\t");
    return {
      id: hash,
      shortId: hash.substring(0, 7),
      subject: subject || "",
      body: body || "",
      prRef: extractPrRef(subject + " " + body),
    };
  });
}

function isArchitecturallySignificant(filePath) {
  const significantPatterns = [
    /^src\/services\//,
    /^src\/routes\//,
    /^src\/db\//,
    /^src\/config/,
    /^src\/index\./,
    /^package\.json$/,
    /^render\.yaml$/,
    /^frontend\/app\/page\.tsx$/,
    /^frontend\/app\/layout\.tsx$/,
    /^frontend\/next\.config/,
    /^frontend\/package\.json$/,
  ];
  return significantPatterns.some((p) => p.test(filePath));
}

function significanceReason(filePath) {
  if (/^src\/services\//.test(filePath)) return "Service layer — business logic";
  if (/^src\/routes\//.test(filePath)) return "API routes — endpoint contracts";
  if (/^src\/db\//.test(filePath)) return "Database layer — schema/connection";
  if (/^src\/config/.test(filePath)) return "Configuration — env/runtime settings";
  if (/^src\/index\./.test(filePath)) return "App bootstrap — route mounting";
  if (/^package\.json$/.test(filePath)) return "Dependencies — package changes";
  if (/^render\.yaml$/.test(filePath)) return "Deployment — Render build/runtime config";
  if (/^frontend\/app\/page\.tsx$/.test(filePath)) return "Dashboard UI — main client view";
  if (/^frontend\/app\/layout\.tsx$/.test(filePath)) return "Frontend layout — root shell";
  if (/^frontend\/next\.config/.test(filePath)) return "Next.js config — build/export settings";
  if (/^frontend\/package\.json$/.test(filePath)) return "Frontend dependencies — package changes";
  return "Other";
}

// GET /api/versions — list all versions derived from git commits (oldest first)
router.get("/versions", async (_req, res) => {
  const raw = git([
    "log",
    "--reverse",
    "--format=%H%x09%s%x09%b%x09%ad",
    "--date=iso",
  ]);
  if (!raw) return res.json({ versions: [] });

  const versions = raw.split("\n").filter(Boolean).map((line, i) => {
    const [hash, subject, body, date] = line.split("\t");
    const versionNumber = i + 1;
    return {
      id: hash,
      shortId: hash.substring(0, 7),
      version: `v${versionNumber}`,
      subject: subject || "",
      body: body || "",
      date: date || "",
      prRef: extractPrRef(subject + " " + body),
    };
  });

  res.json({ versions });
});

// GET /api/version-diff?base=<sha>&compare=<sha>
router.get("/version-diff", async (req, res) => {
  const { base, compare } = req.query;
  if (!base || !compare) {
    return res.status(400).json({ error: "base and compare query parameters are required" });
  }

  const nameStatusRaw = git(["diff", "--name-status", base, compare]);
  const statRaw = git(["diff", "--stat", base, compare]);
  const logRaw = git(["log", `${base}..${compare}`, "--format=%H%x09%s%x09%b", "--reverse"]);

  const changedFiles = [];
  for (const line of nameStatusRaw.split("\n").filter(Boolean)) {
    const parts = line.split("\t");
    if (parts.length < 2) continue;
    const status = parts[0];
    const pathField = parts[1];
    const previousPath = parts.length >= 3 && status === "R" ? parts[2] : undefined;
    changedFiles.push({
      status,
      path: pathField,
      previousPath,
      significant: isArchitecturallySignificant(pathField),
      significance: isArchitecturallySignificant(pathField) ? significanceReason(pathField) : null,
    });
  }

  const significantChanges = changedFiles.filter((f) => f.significant);
  const commits = parseCommits(logRaw);

  let insertions = 0;
  let deletions = 0;
  for (const line of statRaw.split("\n").filter(Boolean)) {
    const match = line.match(/(\d+)\s+(\d+)/);
    if (match) {
      insertions += parseInt(match[1], 10);
      deletions += parseInt(match[2], 10);
    }
  }

  res.json({
    base: { id: base, shortId: base.substring(0, 7) },
    compare: { id: compare, shortId: compare.substring(0, 7) },
    changedFiles,
    significantChanges,
    commits,
    summary: {
      totalFiles: changedFiles.length,
      significantFiles: significantChanges.length,
      insertions,
      deletions,
    },
  });
});

export default router;
