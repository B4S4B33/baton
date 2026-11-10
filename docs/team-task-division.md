# Knowledge Handover Platform — Team Task Division (4 Members)

## Team Roles

| Member | Role | Primary Focus |
|--------|------|---------------|
| **Member 1** | Backend Engineer | Express API, PostgreSQL, Neo4j, authentication |
| **Member 2** | Frontend Engineer | Next.js UI, React components, handover views, citations |
| **Member 3** | AI & Data Engineer | Hugging Face / Ollama LLM, source connectors, graph reconstruction |
| **Member 4** | Integration & QA Engineer | Validation gate, BullMQ workers, testing, deployment, documentation |

---

## Round 1 — The Plan (2 Days)

**Goal:** Produce the case, architecture, and setup. No production code yet.

### Day 1 — Research & Architecture

| Member | Responsibility |
|--------|---------------|
| **Member 1** | Define database schema (PostgreSQL + Neo4j). Decide auth strategy (Clerk vs Passport). Sketch API route structure. |
| **Member 2** | Wireframe the three core screens: ingestion dashboard, claim review UI, role-scoped handover view. Decide UI library (Tailwind + shadcn/ui or plain Tailwind). |
| **Member 3** | Research LLM providers (Hugging Face Llama-3.1-8B-Instruct vs Ollama). Test free-tier rate limits. Draft prompt templates for decision extraction and contradiction detection. |
| **Member 4** | Research connector APIs (GitHub, Slack, Jira, Google Drive, Zoom/Fireflies). Check rate limits and OAuth requirements. Draft deployment plan (no Docker). |

**Collaboration:** All four review and agree on the data model, tech stack, and round 2 scope. Finalize the PDF plan and this task division.

### Day 2 — Environment & Repo Setup

| Member | Responsibility |
|--------|---------------|
| **Member 1** | Initialize backend repo. Install Express, dotenv, cors. Set up PostgreSQL database and Neo4j Desktop locally. Create `.env.example`. |
| **Member 2** | Initialize frontend repo (Next.js + TypeScript + Tailwind). Set up basic layout and routing. |
| **Member 3** | Create `backend/src/services/llm.js` with Hugging Face + Ollama support. Write `llm.test.js` to verify LLM calls work. |
| **Member 4** | Set up Redis (local or cloud free tier). Configure GitHub repo with branch protection. Create README with setup instructions. |

**End of Round 1 Deliverable:** Submitted plan PDF, repo initialized, local environments running, LLM test passing.

---

## Round 2 — The Build (3 Days)

**Goal:** End-to-end working product. A judge can open the link and use the core workflow.

### Day 1 — Backend & Ingestion (Member 1 & Member 3)

| Member | Responsibility |
|--------|---------------|
| **Member 1** | Build Express API routes: `POST /ingest`, `GET /sources`, `POST /auth/*`. Connect PostgreSQL for Source records (ACL, content_hash, timestamp). Connect Neo4j for Source and Fragment nodes. |
| **Member 3** | Build GitHub connector: fetch issues, PRs, comments, CODEOWNERS via GitHub API. Normalize into common Source schema. Store raw artifacts in local `/uploads` folder. |
| **Member 1 + Member 3** | Integrate: ingestion worker pushes sources to Neo4j graph. Verify data flows from GitHub → Express → PostgreSQL + Neo4j. |

### Day 2 — Reconstruction, Verification & Review (Member 3 & Member 2)

| Member | Responsibility |
|--------|---------------|
| **Member 3** | LLM service: decision extraction, entity recognition, confidence scoring, contradiction detection. Store Claims in Neo4j linked to Source Fragments with citations. |
| **Member 2** | Build claim review UI: list proposed claims with source citations. Buttons to accept / reject / edit. Display confidence scores and uncertainty flags. |
| **Member 3 + Member 2** | Connect frontend to backend: fetch proposed claims, submit review decisions. Audit log stored in PostgreSQL (who, what, when, why). |

### Day 3 — Validation Gate & Handover (Member 4 & Member 2)

| Member | Responsibility |
|--------|---------------|
| **Member 4** | Build validation gate: citation integrity check, contradiction re-scan, confidence recalculation, permission re-validation, completeness check. Pass/fail gate blocks publication. |
| **Member 2** | Build role-scoped handover views: Developer / PM / New Hire. Apply claim-level redaction based on user role. Render citations as clickable links to source. |
| **Member 4** | Deploy backend and frontend to a public URL (Render, Railway, Vercel, or similar free tier). Verify the full flow: connect GitHub → reconstruct → review → validate → handover → acknowledge. |

**End of Round 2 Deliverable:** Live product. Core workflow runs: GitHub ingestion → claim graph → human review → validation gate → role-scoped handover view.

---

## Round 3 — The Finish (3 Days)

**Goal:** Polish into a product people would actually use.

### Day 1 — Feature Completion (Member 3 & Member 4)

| Member | Responsibility |
|--------|---------------|
| **Member 3** | Add Google Drive connector (Docs, Sheets, Slides) with inherited ACLs. Add AI meeting summary connector (Zoom AI Companion, Google Meet summary, Fireflies.ai, Otter.ai). |
| **Member 4** | Build Phase 3 on-demand code version comparison: user selects two versions (e.g., v5 vs v3), fetch diffs from GitHub, surface architecturally significant changes linked to PRs/tickets. |
| **Member 1** | Fix Round 2 bugs: auth edge cases, Neo4j connection drops, PostgreSQL query optimization. |

### Day 2 — Polish & Testing (Member 2 & Member 4)

| Member | Responsibility |
|--------|---------------|
| **Member 2** | UI/UX tightening: loading states, empty states, error messages, citation rendering, mobile responsiveness. |
| **Member 4** | End-to-end testing of main journeys: connect source → reconstruct → review → validate → handover → acknowledge. Write test cases for permission-aware redaction (incoming person sees only authorized claims). |
| **Member 2 + Member 4** | Bug bash: fix all faults found during testing. |

### Day 3 — Documentation & Final Deploy (All Members)

| Member | Responsibility |
|--------|---------------|
| **Member 1** | Write backend README: API documentation, environment variables, database setup. |
| **Member 2** | Write frontend README: component structure, how to run, design decisions. |
| **Member 3** | Document LLM usage: prompt examples, provider switching (Hugging Face vs Ollama), rate limit handling. |
| **Member 4** | Write user guide: how a reviewer uses the claim review UI, how an incoming person reads the handover, how to acknowledge receipt. Final deploy to production URL. |

**End of Round 3 Deliverable:** Polished, documented, deployed product with Drive + meeting connectors, code comparison, validation gate, role-scoped views, and full documentation.

---

## Collaboration Points (Where Members Must Sync)

| Sync Point | Members Involved | When |
|------------|-----------------|------|
| API contract agreement | Member 1 + Member 2 | Start of Round 2 Day 1 |
| Data model finalization | Member 1 + Member 3 | Start of Round 2 Day 1 |
| LLM response format | Member 3 + Member 2 | Start of Round 2 Day 2 |
| Validation gate output format | Member 4 + Member 2 | Start of Round 2 Day 3 |
| Connector output schema | Member 3 + Member 1 | Round 3 Day 1 |
| Final integration test | All 4 | Round 3 Day 2 |

---

## Risk Mitigation

| Risk | Owner | Mitigation |
|------|-------|------------|
| Hugging Face rate limit blocks LLM during build | Member 3 | Fall back to Ollama (local, unlimited) by changing one env var. |
| Neo4j connection fails on deploy | Member 1 | Have PostgreSQL-only fallback for MVP; Neo4j is nice-to-have for graph queries. |
| Frontend blocks on backend API | Member 2 | Use mock data locally until API is ready; switch to real API same day. |
| OAuth for GitHub/Drive takes too long | Member 4 | Hardcode a test repo for demo; add OAuth in Round 3 if time permits. |

---

## Files for Reference

- `D:\study\codewithpune/tech-stack.md` — Full stack details
- `D:\study\codewithpune/architecture.md` — System diagrams
- `D:\study\codewithpune/workflow.md` — Workflow diagrams
- `D:\study\codewithpune/hackathon-submission.md` — Plan, impact, future scope
