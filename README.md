# Knowledge Handover Platform

A system that converts scattered project activity into a usable handover when a team member leaves. Built for the Three-Round Challenge 02 — preventing critical knowledge from leaving with people.

## Problem

When employees, volunteers, or student team members leave a project, important knowledge disappears with them. Documents may exist, but the reasoning behind decisions, unfinished work, dependencies, recurring problems, and important contacts are scattered across messages, repositories, meeting notes, and task boards.

This platform reconstructs the current state of a project from authorized sources, identifies important decisions, unresolved questions, responsibilities, risks, dependencies, and next actions — with every generated summary linking back to its supporting source.

## Features

- **Connect:** Import authorized data from GitHub (issues, PRs, comments, code owners)
- **Reconstruct:** Auto-detect decisions, ownership, timeline, and open questions from project activity
- **Verify:** Every claim carries a citation to its source, a confidence score, and explicit uncertainty flags
- **Review:** Human-in-the-loop — accept, reject, or edit each claim before approval
- **Handover:** Role-appropriate views scoped to the incoming person's permissions (developer, PM, new hire)
- **Citations:** Every claim links back to its original source (PR, issue, commit)
- **Confidence scoring:** Claims are scored 0.0–1.0 based on source authority and corroboration
- **Uncertainty handling:** Missing or conflicting evidence is surfaced as gaps, not invented answers

## Architecture

```
Connect → Reconstruct → Verify → Review → Validate → Handover
```

1. **Connect:** GitHub connector fetches issues and PRs via the GitHub API
2. **Reconstruct:** Converts raw sources into a knowledge graph with typed nodes (Decision, Task, Question, Dependency, Risk, Contact)
3. **Verify:** Links every claim to source fragments with confidence scores and contradiction detection
4. **Review:** Human reviewer accepts, rejects, or edits claims with full audit logging
5. **Validate:** Automated validation gate checks citation integrity, contradictions, permissions, and completeness
6. **Handover:** Role-scoped rendering with claim-level redaction

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js + Express |
| Frontend | Next.js + React + TypeScript |
| Database | Neo4j (graph) + PostgreSQL (relational) |
| Cache/Queue | Redis + BullMQ |
| LLM | Hugging Face Inference API (Llama-3.1-8B-Instruct) or Ollama (local) |
| Auth | Clerk / Passport.js |
| Storage | MinIO / AWS S3 |

## Project Structure

```
knowledge-handover/
├── backend/
│   ├── .env
│   ├── package.json
│   ├── src/
│   │   ├── index.js          # Express entry point
│   │   ├── config.js         # Environment configuration
│   │   ├── db/
│   │   │   ├── neo4j.js      # Neo4j graph database connection
│   │   │   └── postgres.js   # PostgreSQL connection
│   │   ├── routes/
│   │   │   └── ingest.js     # GitHub ingestion + claim CRUD
│   │   └── services/
│   │       └── llm.js        # LLM service (Hugging Face + Ollama)
│   └── .gitignore
├── frontend/
│   ├── .env
│   ├── package.json
│   ├── next.config.js
│   ├── tsconfig.json
│   ├── app/
│   │   ├── layout.tsx
│   │   └── page.tsx          # Claim review UI
│   └── .gitignore
└── README.md
```

## Quick Start

### Prerequisites

- Node.js 18+
- Neo4j Desktop (Community Edition)
- PostgreSQL
- Redis (optional, for background jobs)
- GitHub Personal Access Token (optional, for higher rate limits)

### 1. Clone the repository

```bash
git clone https://github.com/B4S4B33/baton.git
cd baton
```

### 2. Backend Setup

```bash
cd backend
npm install
cp .env.example .env
# Edit .env with your Neo4j credentials, PostgreSQL URL, and other settings
npm run dev
```

Backend runs on `http://localhost:3000`

### 3. Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

Frontend runs on `http://localhost:3001`

### 4. Neo4j Setup

1. Download Neo4j Desktop from [neo4j.com/download](https://neo4j.com/download/)
2. Create a local DBMS instance
3. Set password (update `.env` with your password)
4. Start the instance
5. Open Neo4j Browser at `http://localhost:7474` and verify with `RETURN 1`

### 5. Test the Flow

1. **Ingest GitHub data:**
   ```bash
   curl -X POST http://localhost:3000/api/ingest/github \
     -H "Content-Type: application/json" \
     -d '{"repo":"owner/repo"}'
   ```

2. **View claims:**
   ```bash
   curl http://localhost:3000/api/claims
   ```

3. **Accept/reject a claim:**
   ```bash
   curl -X PATCH http://localhost:3000/api/claims/<claim-id> \
     -H "Content-Type: application/json" \
     -d '{"status":"accepted"}'
   ```

4. **Open the frontend:** `http://localhost:3001`

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| POST | `/api/ingest/github` | Ingest issues and PRs from a GitHub repo |
| GET | `/api/claims` | List all claims with evidence links |
| PATCH | `/api/claims/:id` | Accept, reject, or edit a claim |

## Trust & Safety

- **No assumptions as verified truth:** Claims default to `status: proposed`; confidence < 0.7 auto-flags as uncertain
- **No confidential exposure:** Source ACLs propagate to claims; render-time redaction by role
- **Human approval required:** Reviewers must accept/reject/edit before publication
- **Synthetic demo data:** Demo mode uses clearly labeled synthetic data

## Future Scope

- **Phase 2:** Google Drive connector, AI meeting summaries (Zoom, Google Meet, Fireflies, Otter)
- **Phase 3:** On-demand code version comparison (compare v5 vs v3)
- Real-time source sync instead of batch ingestion
- Additional connectors: Confluence, Notion, Microsoft Teams, Azure Boards
- Self-hosted LLM options for organizations with strict data privacy
- Analytics dashboard for knowledge gaps across teams
- HR offboarding workflow integration (BambooHR, Workday)

## License

ISC