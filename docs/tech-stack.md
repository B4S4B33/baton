# Knowledge Handover Platform — Tech Stack (Node.js, No Docker)

## Recommended Stack

| Layer | Technology | Cost | Notes |
|-------|-----------|------|-------|
| **Runtime** | Node.js 18+ LTS | Free | Download from nodejs.org |
| **Backend API** | Express.js | Free | Simple, easy to learn, huge ecosystem |
| **Graph Database** | Neo4j Community Edition | Free | Self-hosted desktop app; `http://localhost:7474` |
| **Relational DB** | PostgreSQL + pgvector | Free | Use Supabase free tier (easiest) or install locally |
| **Cache / Queue** | Redis | Free | `brew install redis` (Mac) or Redis Cloud free tier |
| **Object Storage** | Local `/uploads` folder | Free | For development; switch to S3 later if needed |
| **Frontend** | Next.js + TypeScript + Tailwind CSS | Free | Node.js-based, already familiar ecosystem |
| **Auth** | Clerk or Passport.js + JWT | Free tier | Clerk has generous free tier; Passport is 100% free |
| **AI / LLM** | Hugging Face Inference API (Llama-3.1-8B-Instruct) OR Ollama (local) | Free | HF: ~30 req/min rate limit; Ollama: unlimited, local |
| **LLM Library** | `node-fetch` (HF) or `openai` SDK (Ollama-compatible) | Free | |
| **Background Jobs** | BullMQ + Redis | Free | For ingestion workers |
| **CI/CD** | GitHub Actions | Free | For public repos |

---

## Free LLM Options

### Option A: Hugging Face Inference API (Recommended to start)

**Model:** `meta-llama/Llama-3.1-8B-Instruct`

- **Cost:** Free
- **Rate limit:** ~30 requests per minute, 1 concurrent request
- **Setup:** Get a free token at [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens)
- **Best for:** Testing, MVP, small team usage
- **Code:** See `backend/src/services/llm.js` — `callHuggingFace()`

### Option B: Ollama (Local, 100% free, no rate limits)

**Model:** `llama3.1:8b`

- **Cost:** Free forever
- **Rate limit:** None (limited only by your hardware)
- **Setup:** Download Ollama desktop app from [ollama.com](https://ollama.com), run `ollama pull llama3.1:8b`
- **Best for:** Development, privacy, offline use
- **Code:** See `backend/src/services/llm.js` — `callOllama()`

Switch between them by changing `LLM_PROVIDER` in `.env`.

---

## Directory Structure

```
knowledge-handover/
├── backend/
│   ├── .env
│   ├── .env.example
│   ├── package.json
│   ├── src/
│   │   ├── index.js          # Express entry point
│   │   ├── routes/
│   │   │   ├── ingest.js     # GitHub, Slack, Jira, Drive, meeting connectors
│   │   │   ├── claims.js     # CRUD for claims
│   │   │   ├── handover.js   # Handover version & view
│   │   │   └── validate.js   # Validation gate
│   │   ├── services/
│   │   │   ├── llm.js        # LLM service (HF + Ollama)
│   │   │   ├── ingest.js     # Source ingestion logic
│   │   │   ├── graph.js      # Neo4j queries
│   │   │   └── validate.js   # Validation rules
│   │   ├── db/
│   │   │   ├── postgres.js   # pg client
│   │   │   └── neo4j.js      # neo4j-driver
│   │   └── workers/
│   │       └── ingestWorker.js  # BullMQ job processor
│   └── test/
│       └── llm.test.js
├── frontend/
│   ├── next.config.js
│   ├── app/
│   ├── components/
│   └── package.json
├── .gitignore
└── README.md
```

---

## Backend `package.json`

```json
{
  "name": "knowledge-handover-backend",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "nodemon src/index.js",
    "start": "node src/index.js",
    "test": "node src/services/llm.test.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "cors": "^2.8.5",
    "dotenv": "^16.3.1",
    "neo4j-driver": "^5.15.0",
    "pg": "^8.11.3",
    "ioredis": "^5.3.2",
    "bullmq": "^5.0.0",
    "node-fetch": "^3.3.2",
    "@clerk/clerk-sdk": "^4.13.0",
    "openai": "^4.20.0"
  },
  "devDependencies": {
    "nodemon": "^3.0.2"
  }
}
```

---

## How to Run Without Docker

### 1. Install Node.js
Download LTS from [nodejs.org](https://nodejs.org)

### 2. Install Dependencies (one-time)
**Mac:**
```bash
brew install postgresql redis
brew services start postgresql
brew services start redis
```

**Windows:**
- Install PostgreSQL from [postgresql.org/download](https://www.postgresql.org/download/)
- Install Redis from [Redis on Windows](https://github.com/redis/redis-windows) or use WSL2
- Or use Redis Cloud free tier (no install)

### 3. Install Neo4j
Download Neo4j Desktop from [neo4j.com/download](https://neo4j.com/download/)
- Start the server
- Set password (remember it for `.env`)
- Access browser UI at `http://localhost:7474`

### 4. Setup Project
```bash
cd knowledge-handover/backend
npm install
cp .env.example .env
# Edit .env with your Neo4j password, HF token, etc.
```

### 5. Run
```bash
# Terminal 1: Backend
npm run dev

# Terminal 2: Frontend (separate folder)
cd frontend
npm install
npm run dev
```

---

## `.env` Configuration

```env
# LLM Provider: huggingface | ollama
LLM_PROVIDER=huggingface

# Hugging Face (free tier)
HF_TOKEN=hf_your_token_here
HF_MODEL=meta-llama/Llama-3.1-8B-Instruct

# Ollama (local, 100% free)
OLLAMA_BASE_URL=http://localhost:11434/v1
OLLAMA_MODEL=llama3.1:8b

# App
PORT=3000
DATABASE_URL=postgresql://postgres:password@localhost:5432/handover
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=your_neo4j_password
REDIS_URL=redis://localhost:6379
CLERK_SECRET_KEY=sk_live_your_clerk_key
```

---

## Files Created

| File | Purpose |
|------|---------|
| `backend/src/services/llm.js` | LLM service with Hugging Face (Llama-3.1-8B-Instruct) + Ollama support |
| `backend/src/services/llm.test.js` | Test script for all LLM functions |
| `backend/.env.example` | Environment variable template |
| `tech-stack.md` | This document |
| `architecture.md` | System architecture diagrams |
| `workflow.md` | Workflow diagrams |

---

## Next Step

Run `npm test` in the backend folder to verify the LLM service works with your chosen provider.

Want me to create the Express `index.js` entry point and Neo4j/PostgreSQL connection files next?