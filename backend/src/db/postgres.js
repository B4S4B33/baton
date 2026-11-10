import { Pool } from "pg";
import { env } from "../config.js";

/**
 * PostgreSQL connection pool.
 * Used for relational data: users, roles, handover versions, audit logs.
 * Falls back gracefully if PostgreSQL is not available.
 */

let pool = null;
let pgConnected = false;
let connectionAttempted = false;

async function ensureConnection() {
  if (pgConnected) return true;
  if (connectionAttempted && !pgConnected) return false;

  connectionAttempted = true;
  try {
    pool = new Pool({
      connectionString: env.DATABASE_URL,
    });
    // Test the connection
    await pool.query("SELECT 1");
    pgConnected = true;
    console.log("PostgreSQL connected successfully");
    return true;
  } catch (e) {
    console.warn("PostgreSQL not available:", e.message);
    pgConnected = false;
    pool = null;
    return false;
  }
}

export { pool, pgConnected, ensureConnection };

export async function query(text, params) {
  const connected = await ensureConnection();
  if (!connected) {
    throw new Error("PostgreSQL not available");
  }
  return pool.query(text, params);
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pgConnected = false;
  }
}