# Baton Knowledge Handover Platform

A role-scoped knowledge handover system that ingests project activity from GitHub (and optionally Google Drive), enriches it with LLM-extracted claims, and surfaces role-specific views (Developer, PM, New Hire) with claim-level redaction, clickable citations, acknowledgement tracking, and on-demand code version comparison.

Built for teams offboarding a departing member ("leaver") — reconstructs decisions, tasks, risks, questions, and dependencies from authorized sources so incoming maintainers can pick up work without losing context.

## What's in the Box

| Layer | Technology |
|-------|-----------|
| Backend | Node.js (ESM) + Express |
| Frontend | Next.js (App Router, `output: 'export'`) + React + TypeScript |
| Graph DB | Neo4j (claims/sources as graph nodes) |
| Relational DB | PostgreSQL (Supabase session pooler) — users, versions, acknowledgements, audit logs |
| LLM | Groq (`openai/gpt-oss-20b`) — claim extraction, confidence scoring, contradiction detection, meeting summarization |
| Deployment | Render (`render.yaml`, `rootDir: backend`) |
| Fallback | In-memory store when Neo4j/Postgres are unavailable |

## Prerequisites

- Node.js 18+
- A GitHub Personal Access Token (optional, but recommended for higher API rate limits)
- A Groq API key (optional — LLM enrichment is disabled without it)
- PostgreSQL (optional — app falls back to in-memory storage if unavailable)
- Neo4j (optional — app falls back to in-memory storage if unavailable)

## 1. Clone the Repository

```bash
git clone https://github.com/B4S4B33/baton.git
cd baton
```

## 2. Backend Setup

```bash
cd backend
npm install
```

Create `backend/.env` (this file is **not** committed — secrets stay local):

```env
PORT=3000

# Databases (optional — in-memory fallback if omitted)
DATABASE_URL=postgresql://user:pass@host:5432/dbname
NEO4J_URI=neo4j+s://<instance>.databases.neo4j.io
NEO4J_USER=your-neo4j-user
NEO4J_PASSWORD=your-neo4j-password

# LLM (Groq)
LLM_PROVIDER=groq
GROQ_API_KEY=your-groq-api-key
GROQ_BASE_URL=https://api.groq.com/openai/v1
GROQ_MODEL=openai/gpt-oss-20b

# GitHub (optional — improves rate limits)
GITHUB_TOKEN=ghp_your-token-here

# Tuning (optional)
GITHUB_TIMEOUT_MS=15000
GITHUB_MAX_PAGES=5
MAX_LLM_ENRICHMENTS=20
LLM_ENRICHMENT_CONCURRENCY=3
LLM_TIMEOUT_MS=12000
NEO4J_CONNECT_TIMEOUT_MS=8000
```

Start the backend:

```bash
npm start
# or for development with auto-reload:
npm run dev
```

Backend runs on `http://localhost:3000`.

## 3. Frontend Setup

The frontend is a static Next.js export that is served by the backend in production. For local development:

```bash
cd frontend
npm install
npm run dev
```

Frontend runs on `http://localhost:3001`.

To build the static export (served by the Express backend):

```bash
cd frontend
npm run build
```

Output goes to `frontend/out/`. The backend serves this automatically on startup if the directory exists.

## 4. Quick Start (Local, No External Databases)

If you don't have PostgreSQL or Neo4j, the app still works using in-memory storage:

```bash
# Terminal 1: backend
cd backend
npm install
# Create .env with at least PORT=3000 (databases optional)
npm start

# Terminal 2: frontend
cd frontend
npm install
npm run dev
```

Then open `http://localhost:3001` in your browser.

### Test the API directly

```bash
# Health check
curl http://localhost:3000/health

# Seed demo data (no GitHub token needed)
curl -X POST http://localhost:3000/api/demo-data

# List claims
curl http://localhost:3000/api/claims

# Ingest a GitHub repo
curl -X POST http://localhost:3000/api/ingest/github \
  -H "Content-Type: application/json" \
  -d '{"repo":"owner/repo"}'

# View role-scoped handover
curl "http://localhost:3000/api/handover/view?role=developer"

# List available versions
curl http://localhost:3000/api/versions

# Compare two versions
curl "http://localhost:3000/api/version-diff?base=<sha1>&compare=<sha2>"

# Clear all data
curl -X POST http://localhost:3000/api/clear
```


4. Add the following environment variables in the Render Dashboard (set as secrets where marked):

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | Supabase session pooler: `postgresql://postgres.<project>.<region>.pooler.supabase.com:5432/postgres` |
| `NEO4J_URI` | Yes | Neo4j AuraDB URI (`neo4j+s://<instance>.databases.neo4j.io`) |
| `NEO4J_USER` | Yes | Neo4j username (app reads `NEO4J_USER`, not `NEO4J_USERNAME`) |
| `NEO4J_PASSWORD` | Yes | Neo4j password |
| `LLM_PROVIDER` | No | `groq` |
| `GROQ_API_KEY` | No | Groq API key |
| `GROQ_BASE_URL` | No | `https://api.groq.com/openai/v1` |
| `GROQ_MODEL` | No | `openai/gpt-oss-20b` |
| `GITHUB_TOKEN` | No | Optional GitHub PAT for higher rate limits |
| `PORT` | No | `3000` |


## Project Structure

```
baton/
├── backend/                 # Express API (served on port 3000)
│   ├── .env                 # Local secrets — NOT committed
│   ├── package.json
│   ├── src/
│   │   ├── index.js         # Express entry point, route mounting, static file serving
│   │   ├── config.js        # Environment configuration
│   │   ├── store.js         # In-memory fallback store
│   │   ├── db/
│   │   │   ├── neo4j.js     # Neo4j driver + timed connectivity check
│   │   │   ├── postgres.js  # Supabase session pooler connection
│   │   │   └── schema.js    # SQL schema init (users, versions, approvals, audit, acknowledgements)
│   │   ├── routes/
│   │   │   ├── ingest.js    # GitHub ingest, clear, demo-data, claims, stats, leaver-activity, action-items, claim patch
│   │   │   ├── drive.js     # Google Drive v3 ingest + ACL snapshot capture
│   │   │   ├── validate.js  # Validation gate (citation, contradiction, confidence, permission, completeness, meeting_authority)
│   │   │   ├── handover.js  # Role-scoped views, acknowledgements
│   │   │   ├── meetings.js  # Provider-agnostic meeting summary ingest
│   │   │   └── version.js   # Version listing and version diff
│   │   └── services/
│   │       ├── llm.js               # Groq client: callLLM, extractClaims, scoreConfidence, detectContradictions, summarizeMeeting
│   │       ├── meetingIngestService.js  # Meeting ingest with authority/corroboration policy
│   │       ├── validationGate.js      # Validation rules
│   │       └── handoverService.js     # Role-scoped view generation, redaction, ACL evaluation
│   └── .gitignore
├── frontend/                # Next.js static export (served by backend)
│   ├── package.json
│   ├── next.config.js       # output: 'export', trailingSlash
│   ├── app/
│   │   ├── layout.tsx
│   │   └── page.tsx         # Dashboard: landing + role views + version comparison
│   └── .gitignore
├── render.yaml              # Render service definition
├── package.json             # Workspace root (convenience scripts)
├── PRODUCT.md               # Detailed product documentation
└── README.md                # This file
```

## API Reference

Base URL: `http://localhost:3000/api` (local) or `https://baton-hztq.onrender.com/api` (production)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| POST | `/ingest/github` | Ingest a GitHub repo. Body: `{ "repo": "owner/repo", "leaverUsername"?, "token"? }` |
| GET | `/claims` | List claims. Query: `?status=`, `?type=`, `?leaver=true/false` |
| GET | `/stats` | Ingestion statistics |
| GET | `/leaver-activity` | Leaver activity summary |
| GET | `/action-items` | Action items list |
| PATCH | `/claims/:id` | Update claim status/text. Body: `{ "status": "...", "text": "..." }` |
| POST | `/clear` | Wipe all claims, sources, and stats |
| POST | `/demo-data` | Seed sample claims/sources/stats for testing |
| POST | `/validate` | Run validation gate. Body: `{ "handoverVersionId", "roleId" }` |
| GET | `/handover/roles` | Available roles (developer, pm, new_hire) |
| GET | `/handover/view` | Role-scoped handover view. Query: `?role=`, `?handoverVersionId=` |
| GET | `/handover/acknowledgements` | List acknowledgements. Query: `?handoverVersionId=` |
| POST | `/handover/acknowledge` | Acknowledge handover. Body: `{ "handoverVersionId", "role", "acknowledgedBy"?, "notes"? }` |
| POST | `/meetings/ingest` | Ingest a meeting summary. Body: `{ provider?, meetingId?, title?, occurredAt?, participants?, summaryText?, transcriptText?, actionItems?, sourceUrl?, metadata? }` |
| GET | `/versions` | List all git-derived versions (`v1`, `v2`, …) |
| GET | `/version-diff` | Compare two versions. Query: `?base=<sha>`, `?compare=<sha>` |

## Frontend Pages

- **Landing page** (`/`): Ingest form — enter a GitHub repo URL, optional leaver username and GitHub token, then click "Start Handover Analysis".
- **Dashboard** (`/` after ingest): Role picker (Developer / PM / New Hire), claims table with type/status/confidence/citation/redaction badges, action items, leaver activity, acknowledgement tracking, version comparison section, Clear All Data button.
- **Version Comparison**: Two dropdowns (base version, compare version), compare button, results showing architecturally significant changes linked to PR/ticket references, commit history, and stats.

## Role Views

| Role | What They See |
|------|---------------|
| **Developer** | All claims, technical detail, code/review context, sensitive values masked |
| **PM** | Decisions, risks, tasks, dependencies, blockers, ownership; low-level review comments hidden |
| **New Hire** | Onboarding-relevant items only; closed PRs/issues and review comments summarized or hidden |

## Data Model

**Claim:** id, type, text, confidence, status, sourceUrl, sourceType, sourceProvider, meetingId, sourceAuthority, corroborated, corroborationCount, needsCorroboration, proof, access, redacted, redactionLevel, redactionReason, author, isLeaver, createdAt, body, labels, assignees, reviewers.

**Source:** url, type, content, author, fileName, fileId, provider, meetingId, sourceAuthority, occurredAt, acl, metadata, createdAt.

**Acknowledgement:** handoverVersionId, role, acknowledgedBy, acknowledgedAt, notes.


## License

ISC