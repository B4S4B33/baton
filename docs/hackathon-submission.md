# Knowledge Handover Platform — Hackathon Submission

## Why This Technology Stack

**Node.js + Express (backend)**
- The team is most comfortable with JavaScript/TypeScript, which reduces onboarding time and bugs during a time-constrained hackathon.
- Express is minimal and easy to debug. There is no hidden magic, which matters when you have three days to build and three days to finish.
- The frontend (Next.js) and backend share the same language ecosystem, so types and utilities can be reused.

**Neo4j Community Edition (knowledge graph)**
- The core product innovation is an evidence-linked knowledge graph where claims, sources, contradictions, and dependencies are nodes and edges.
- A relational table cannot express "this decision contradicts that ticket" or "this task depends on that PR" as naturally as a graph.
- Neo4j Desktop installs without Docker, which matches our constraint of zero-container setup.

**PostgreSQL + pgvector (relational + vector)**
- Users, roles, handover versions, audit logs, and validation results are relational data. PostgreSQL handles this reliably.
- pgvector stores embeddings for source fragments, enabling semantic search to find conflicting claims across Slack, Jira, and meeting summaries without adding a separate vector database.

**Hugging Face Inference API (Llama-3.1-8B-Instruct) with Ollama fallback**
- The LLM is used for decision extraction, contradiction detection, confidence scoring, and meeting summarization — not for chat.
- Hugging Face offers a free tier with Llama-3.1-8B-Instruct, which has strong reasoning for structured JSON extraction.
- Ollama runs locally at zero cost with no rate limits, so development is not blocked by API quotas during the hackathon.
- The service layer abstracts the provider, so we can switch between them by changing one environment variable.

**Next.js + TypeScript + Tailwind (frontend)**
- TypeScript catches interface errors early, which is critical when the handover view must render claims, citations, and redactions correctly.
- Tailwind speeds up UI implementation so we spend time on functionality, not CSS architecture.

**No Docker**
- Docker setup consumes time that should go into building features. All services (PostgreSQL, Redis, Neo4j) install directly on macOS/Windows and run as local services.

---

## Major Technical Challenge and Mitigation

**Challenge: Reconstructing a reliable project state from scattered, unstructured, and contradictory sources.**

A leaver's knowledge lives in GitHub PRs, Slack threads, Jira tickets, Google Docs, and meeting summaries. These sources disagree, omit context, and use informal language. If the system presents an LLM guess as verified truth, it fails the trust requirement.

**Mitigation plan:**

1. **Evidence linking, not generation.** Every claim in the graph carries a citation to a specific source fragment (PR #412, Slack message, Jira PROJ-88, meeting summary timestamp). The incoming person can click through to verify context.
2. **Uncertainty as a first-class field.** Claims default to `status: proposed`. Confidence scores (0.0–1.0) are assigned based on source authority (code > ticket > doc > chat) and corroboration count. Missing evidence is surfaced as a gap, not filled with a guess.
3. **Contradiction detection.** When two sources say different things about the same fact (for example, a doc says "API v2 is deprecated" while a ticket says "shipping v2 next week"), the system flags a contradiction for human review instead of picking a side.
4. **Human-in-the-loop review.** A responsible person (manager or tech lead) accepts, rejects, or edits every claim before the handover is published.
5. **Automated validation gate.** After human review, an automated check re-verifies citation integrity, contradictions, permission-level redaction, and completeness. Critical failures block publication.

---

## Development Plan Across Three Rounds

### Round 1 — The Plan (2 days)

**Goal:** Produce a clear, feasible, and original case for what to build. No production code.

**Day 1:**
- Finalize the problem statement and target user (engineering teams, student clubs, volunteer groups with departing members).
- Select the technology stack and justify each choice.
- Define the data model: Source, Fragment, Claim, ClaimEvidence, Contradiction, HandoverVersion, HandoverView, ValidationResult, ValidationRule.
- Wireframe the three core screens: ingestion dashboard, claim review UI, and role-scoped handover view.

**Day 2:**
- Write this plan document and the architecture/workflow diagrams.
- Define acceptance criteria for Round 2: one connector (GitHub issues + PRs), Neo4j graph with citation links, review UI, validation gate, and one role-scoped handover view.
- Set up the repository and local development environment (Node.js, PostgreSQL, Neo4j, Redis) without Docker.

**Deliverable:** A PDF plan (per hackathon format) plus this markdown document and diagrams.

---

### Round 2 — The Build (3 days)

**Goal:** An end-to-end working product that a judge can open and use.

**Day 1 — Backend and ingestion:**
- Express API with authentication (Clerk or Passport.js).
- GitHub connector: fetch issues, PRs, comments, and CODEOWNERS.
- Store raw sources in PostgreSQL with ACL and content hash.
- Neo4j integration: create Source, Fragment, and Claim nodes with edges.

**Day 2 — Reconstruction, verification, and review:**
- LLM service (Hugging Face Llama-3.1-8B-Instruct or Ollama) for decision extraction, entity recognition, and confidence scoring.
- Contradiction detection between claims.
- Next.js frontend: claim review UI where a human accepts, rejects, or edits claims.
- Audit log of every review action (who, what, when, why).

**Day 3 — Validation gate and handover:**
- Automated validation gate: citation integrity, contradiction re-scan, permission re-validation, completeness check.
- Role-scoped handover views (developer, PM, new hire) with claim-level redaction.
- Deploy to a publicly accessible URL so judges can test the core workflow.

**Deliverable:** A live product where a user connects a GitHub repo, reviews generated claims, and receives a role-appropriate handover.

---

### Round 3 — The Finish (3 days)

**Goal:** Turn a working prototype into a product people would actually use.

**Day 1 — Feature completion:**
- Add Google Drive connector (Docs, Sheets, Slides) with inherited ACLs.
- Add AI meeting summary connector (Zoom AI Companion, Google Meet summary, Fireflies.ai, Otter.ai).
- Add Phase 3 on-demand code version comparison (user selects two versions, e.g., v5 vs v3, to see architecturally significant changes).
- Fix known faults from Round 2 judge feedback.

**Day 2 — Polish and testing:**
- UI/UX tightening: loading states, empty states, error messages, citation rendering.
- Test the main journeys: connect source → reconstruct → review → validate → handover → acknowledge.
- Write documentation: README, API usage, and a user guide for reviewers and incoming persons.

**Day 3 — Final verification and submission:**
- End-to-end test with a synthetic project dataset clearly marked as synthetic.
- Confirm permission-aware redaction works (incoming person sees only authorized claims).
- Final deploy and submission.

**Deliverable:** A polished, documented, deployed product with working connectors, review UI, validation gate, and role-scoped handover views.

---

## Expected Impact of the Solution

**For the incoming person:**
- Understands ownership, risks, and next steps on day one instead of spending weeks reconstructing context.
- Every important statement links back to its source, so they can verify decisions rather than trusting stale documentation.
- Sees only what they are authorized to access, preventing confidential information leaks.

**For the departing person:**
- Leaves with a structured continuation plan instead of a blank Google Doc and a rushed exit meeting.
- Their knowledge is preserved with attribution, reducing the guilt and pressure of incomplete handovers.

**For the team:**
- Reduces transition time and operational disruption when members leave.
- Creates an immutable approval trail (who approved what, when, which version) for compliance and accountability.
- Surfaces recurring problems and dependencies that were previously invisible across scattered tools.

---

## Future Scope of the Product

**Phase 3 (post-hackathon):**
- On-demand code version comparison between any two user-specified releases (v5 vs v3), surfacing architecturally significant changes linked to authorizing PRs and tickets.
- Real-time source sync instead of batch ingestion, so the knowledge graph stays current as work happens.
- Additional connectors: Confluence, Notion, Microsoft Teams, Azure Boards.

**Longer term:**
- Self-hosted LLM options (Ollama, local models) for organizations with strict data privacy requirements.
- Analytics dashboard showing knowledge gaps across teams (which services have only one owner, which decisions lack documentation).
- Mobile app for incoming persons to review handovers on the go.
- Integration with HR offboarding workflows (BambooHR, Workday) so knowledge transfer triggers automatically when a departure is recorded.
