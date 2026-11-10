import { env } from "./config.js";
import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import ingestRoute from "./routes/ingest.js";
import driveRoute from "./routes/drive.js";
import validateRoute from "./routes/validate.js";
import { closeDriver } from "./db/neo4j.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = env.PORT || 3000;

app.use(cors({
  origin: ["http://localhost:3000", "http://localhost:3001"],
  credentials: true,
}));
app.use(express.json());
app.use("/api", ingestRoute);
app.use("/api", driveRoute);
app.use("/api", validateRoute);

app.get("/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// Serve frontend static files (built output from frontend/out)
// In production, the frontend is built into ../frontend/out
const frontendOutDir = path.resolve(__dirname, "../../frontend/out");

if (fs.existsSync(frontendOutDir)) {
  app.use(express.static(frontendOutDir));
  // SPA fallback: serve index.html for any non-API route
  app.use("*", (req, res) => {
    res.sendFile(path.join(frontendOutDir, "index.html"));
  });
} else {
  app.use("*", (req, res) => {
    res.json({ message: "Frontend not built yet. Build frontend first.", api: "Use /api/* endpoints" });
  });
}

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

// Graceful shutdown
process.on("SIGINT", async () => {
  await closeDriver();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await closeDriver();
  process.exit(0);
});