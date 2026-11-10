import dotenv from "dotenv";
dotenv.config();

export const env = {
  PORT: process.env.PORT || 3000,
  DATABASE_URL: process.env.DATABASE_URL,
  NEO4J_URI: process.env.NEO4J_URI,
  NEO4J_USER: process.env.NEO4J_USER,
  NEO4J_PASSWORD: process.env.NEO4J_PASSWORD,
  REDIS_URL: process.env.REDIS_URL,
  LLM_PROVIDER: process.env.LLM_PROVIDER || "ollama",
  OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL || "http://localhost:11434/v1",
  OLLAMA_MODEL: process.env.OLLAMA_MODEL || "llama3.1:8b",
};