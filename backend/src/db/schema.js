import { query } from "./postgres.js";

/**
 * Initialize database tables for the handover platform.
 * Creates tables if they don't exist.
 * Runs automatically on startup if PostgreSQL is available.
 */

export async function initSchema() {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        role VARCHAR(50) NOT NULL DEFAULT 'developer',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS handover_versions (
        id SERIAL PRIMARY KEY,
        project_id VARCHAR(255) NOT NULL,
        leaver_id VARCHAR(255),
        approver_id INTEGER REFERENCES users(id),
        status VARCHAR(50) DEFAULT 'draft',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        approved_at TIMESTAMP
      )
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS claim_approvals (
        id SERIAL PRIMARY KEY,
        claim_id VARCHAR(255) NOT NULL,
        version_id INTEGER REFERENCES handover_versions(id),
        approver_id INTEGER REFERENCES users(id),
        action VARCHAR(50) NOT NULL,
        reason TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        action VARCHAR(100) NOT NULL,
        entity_type VARCHAR(50) NOT NULL,
        entity_id VARCHAR(255) NOT NULL,
        details JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log("Database schema initialized successfully");
  } catch (e) {
    console.warn("Schema initialization failed:", e.message);
  }
}