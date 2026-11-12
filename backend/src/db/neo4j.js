import neo4j from "neo4j-driver";
import { env } from "../config.js";

/**
 * Neo4j driver configuration.
 * Uses URI scheme to determine encryption/TLS (e.g. neo4j+s:// for Aura).
 * For local bolt:// URIs without explicit scheme encryption, encryption is disabled.
 */
let driver = null;

function createDriver() {
  if (!env.NEO4J_URI) return null;

  const auth = neo4j.auth.basic(env.NEO4J_USER, env.NEO4J_PASSWORD);
  const uri = env.NEO4J_URI;

  // Cloud/Aura URIs typically encode encryption in the scheme (neo4j+s, neo4j+ssc, bolt+s, bolt+ssc)
  if (/^(neo4j\+s|neo4j\+ssc|bolt\+s|bolt\+ssc):\/\//i.test(uri)) {
    return neo4j.driver(uri, auth);
  }

  // Local development convenience: disable encryption for plain bolt://localhost unless explicitly configured
  if (/^bolt:\/\//i.test(uri) && /localhost|127\.0\.0\.1/i.test(uri)) {
    return neo4j.driver(uri, auth, { encrypted: "ENCRYPTION_OFF" });
  }

  return neo4j.driver(uri, auth);
}

driver = createDriver();

export const getSession = () => {
  if (!driver) throw new Error("Neo4j driver not initialized (NEO4J_URI not set)");
  return driver.session();
};

export const closeDriver = async () => {
  if (driver) {
    await driver.close();
  }
};