import neo4j from "neo4j-driver";
import { env } from "../config.js";

const driver = neo4j.driver(
  env.NEO4J_URI,
  neo4j.auth.basic(env.NEO4J_USER, env.NEO4J_PASSWORD),
  { encrypted: false }
);

export const getSession = () => driver.session();

export const closeDriver = async () => {
  await driver.close();
};