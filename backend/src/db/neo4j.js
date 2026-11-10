import neo4j from "neo4j-driver";
import { env } from "../config.js";

/**
 * Neo4j driver configuration.
 * Tries multiple TLS configurations to connect to Neo4j 4.x or 5.x.
 */
let driver = null;

function createDriver() {
  // Try encrypted: false first (Neo4j 4.x default)
  try {
    return neo4j.driver(
      env.NEO4J_URI,
      neo4j.auth.basic(env.NEO4J_USER, env.NEO4J_PASSWORD),
      { encrypted: false }
    );
  } catch (e) {
    // Fall through to next option
  }

  // Try tls: 'OPTIONAL' (Neo4j 5.x default)
  try {
    return neo4j.driver(
      env.NEO4J_URI,
      neo4j.auth.basic(env.NEO4J_USER, env.NEO4J_PASSWORD),
      { tls: 'OPTIONAL' }
    );
  } catch (e) {
    // Fall through to next option
  }

  // Try tls: 'DISABLED'
  try {
    return neo4j.driver(
      env.NEO4J_URI,
      neo4j.auth.basic(env.NEO4J_USER, env.NEO4J_PASSWORD),
      { tls: 'DISABLED' }
    );
  } catch (e) {
    // Fall through
  }

  // Last resort: no extra options
  return neo4j.driver(
    env.NEO4J_URI,
    neo4j.auth.basic(env.NEO4J_USER, env.NEO4J_PASSWORD)
  );
}

driver = createDriver();

export const getSession = () => driver.session();

export const closeDriver = async () => {
  if (driver) {
    await driver.close();
  }
};