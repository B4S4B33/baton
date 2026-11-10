import { env } from "./config.js";
import express from "express";
import cors from "cors";
import { getSession, closeDriver } from "./db/neo4j.js";
import { query, closePool } from "./db/postgres.js";
import ingestRoute from "./routes/ingest.js";

const app = express();
const PORT = env.PORT || 3000;

app.use(cors({
  origin: ["http://localhost:3000", "http://localhost:3001"],
  credentials: true,
}));
app.use(express.json());
app.use("/api", ingestRoute);

async function testConnections() {
  try {
    const session = getSession();
    await session.run("RETURN 1");
    await session.close();
    console.log("Neo4j connected");
  } catch (e) {
    console.error("Neo4j connection failed:", e.message);
  }

  try {
    await query("SELECT NOW()");
    console.log("PostgreSQL connected");
  } catch (e) {
    console.error("PostgreSQL connection failed:", e.message);
  }
}

testConnections();

app.get("/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

process.on("SIGINT", async () => {
  await closeDriver();
  await closePool();
  process.exit(0);
});