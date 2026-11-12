import dotenv from "dotenv";
dotenv.config();

export const env = {
  PORT: process.env.PORT || 3000,
  DATABASE_URL: process.env.DATABASE_URL,
  NEO4J_URI: process.env.NEO4J_URI,
  NEO4J_USER: process.env.NEO4J_USER,
  NEO4J_PASSWORD: process.env.NEO4J_PASSWORD,
  REDIS_URL: process.env.REDIS_URL,

  // LLM configuration (Groq preferred)
  LLM_PROVIDER: process.env.LLM_PROVIDER || "groq",
  GROQ_API_KEY: process.env.GROQ_API_KEY,
  GROQ_BASE_URL: process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1",
  GROQ_MODEL: process.env.GROQ_MODEL || "openai/gpt-oss-20b",

  // Legacy/local placeholders (not used by default)
  OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL || "http://localhost:11434/v1",
  OLLAMA_MODEL: process.env.OLLAMA_MODEL || "llama3.1:8b",
};