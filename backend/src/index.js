import { env } from "./config.js";
import express from "express";
import cors from "cors";
import ingestRoute from "./routes/ingest.js";
import driveRoute from "./routes/drive.js";
import validateRoute from "./routes/validate.js";
import { closeDriver } from "./db/neo4j.js";

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