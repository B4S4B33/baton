# Knowledge Handover Platform — Developer Proposal

## The Innovative Bet

Most handover tools are wikis or exporters: they dump data and hope someone reads it. The differentiator here is an **evidence-linked, uncertainty-aware knowledge graph** where every claim carries (a) a citation to its source, (b) a confidence score, and (c) an explicit "unknown" or "conflicting" state when evidence is missing or contradictory. The output is not a summary document — it is a **continuation plan** scoped to the incoming person's role and permissions.

---

## Architecture (6 Layers, Matching the Required Workflow)

### Layer 1 — Connect (Ingestion)

Authorised connectors pull from sources the leaver had access to:

- **Repositories:** GitHub/GitLab (commits, PRs, issues, comments, code owners)
- **Tasks:** Jira, Linear, Trello, Azure Boards (tickets, status, assignees, history)
- **Docs:** Confluence, Notion, Google Drive, SharePoint
- **Comms:** Slack, Microsoft Teams, email threads (channel/message history)
- **Meetings:** AI-generated summaries and key points (Zoom AI Companion, Google Meet summary, Fireflies.ai, tl;dv, Otter.ai) — structured decisions, action items, and key points rather than raw video or full transcripts

Each ingested item is stored as a raw **Source** record with its original ACL, a content hash, and an ingest timestamp. Nothing is mutated; sources are append-only.

### Layer 2 — Reconstruct (Project-State Reconstruction)

A pipeline converts raw sources into a canonical knowledge graph:

1. **Entity extraction** — people, repos, services, APIs, domains, vendors, tools
2. **Decision detection** — pattern-match on "decided", "agreed", "P&R", "ADR", PR merge messages, architecture docs
3. **Ownership inference** — code ownership (CODEOWNERS, git blame), ticket assignees, doc authors, @mentions in threads
4. **Timeline assembly** — chronological graph of decisions, changes, blockers, releases
5. **Dependency mapping** — import statements, service-to-service calls, ticket links, shared libraries
6. **Recurring problem detection** — cluster similar issue titles/labels/comments across time

Output: typed nodes (Decision, OpenQuestion, Task, Dependency, Blocker, Risk, Contact, RecurringIssue) and edges (references, blocks, depends-on, owned-by, decided-at).

### Layer 3 — Verify (Evidence Linking & Uncertainty)

Every claim in the graph is backed by one or more source fragments:

- **Citation** — direct link/quote to the source (PR #412, Slack thread, Jira PROJ-88)
- **Confidence score** — 0.0–1.0 based on source recency, authority (code > chat > email), and corroboration count
- **Contradiction detection** — two sources saying different things about the same fact (e.g., "API v2 is deprecated" in a doc vs. "shipping v2 next week" in a ticket)
- **Uncertainty flag** — no supporting source, or confidence below threshold

The system never invents an answer. If evidence is missing, the node is marked `evidence: missing` and surfaced as a gap for the reviewer.

### Layer 4 — Review (Human-in-the-Loop)

A responsible person (leaver's manager, tech lead, or project owner) reviews the generated graph:

- Accept, reject, or edit each claim
- Merge duplicate nodes
- Add manual notes where automation failed
- Approve a versioned handover snapshot

Every change is immutably logged (who, what, when, why). Approved versions are snapshotted; prior versions remain accessible for audit.

### Layer 5 — Validate (Verification & Validation Gate)

Before the approved graph is shared, an automated validation gate runs a final check on the human-edited handover:

- **Citation integrity** — every claim still references at least one live, accessible source fragment; orphaned claims are flagged
- **Contradiction re-scan** — re-runs contradiction detection after human edits to catch new conflicts introduced during review
- **Confidence recalculation** — recalculates confidence scores based on updated evidence weights and source recency
- **Permission re-validation** — re-checks ACLs on any newly added or edited content to ensure no confidential data leaked into a role-scoped view
- **Completeness check** — verifies that critical areas (ownership, blockers, dependencies, next actions) are covered for the target role; surfaces gaps as required reviewer actions
- **Validation report** — produces a pass/fail gate with a list of issues; the handover cannot be published until critical validations pass or are explicitly overridden by an approver

Only after the validation gate passes does the handover proceed to rendering.

### Layer 6 — Handover (Role-Appropriate Sharing)

The validated graph is rendered into views scoped by the incoming person's role and permissions:

- **Developer view:** code ownership, open PRs, tech debt, API contracts, on-call rotation
- **PM view:** milestones, blockers, stakeholder contacts, upcoming decisions
- **New hire view:** onboarding checklist, recurring issues, where to ask questions

Confidential or unauthorised sources are redacted at render time — the incoming person sees only what they are authorised to access, not merely what existed in a connected source.

---

## Data Model (Simplified)

| Entity | Fields |
|--------|--------|
| **Source** | id, type, url, content_hash, acl, ingested_at, raw_content |
| **Fragment** | id, source_id, quote, start_offset, end_offset, embedding |
| **Claim** | id, type (decision\|question\|task\|dependency\|risk\|contact), text, confidence, status (proposed\|accepted\|rejected\|edited) |
| **ClaimEvidence** | claim_id, fragment_id, weight |
| **Contradiction** | claim_a_id, claim_b_id, description |
| **HandoverVersion** | id, project_id, leaver_id, approver_id, status (draft\|approved\|superseded), created_at |
| **HandoverView** | version_id, role_id, redacted_node_ids, rendered_content |
| **Acknowledgement** | handover_id, recipient_id, acknowledged_at, role_at_handover |
| **ValidationResult** | id, handover_version_id, rule_id, status (pass|fail|warning), detail, checked_at |
| **ValidationRule** | id, name, type (citation_integrity|contradiction|confidence|permission|completeness), severity (critical|warning), enabled |

---

## How the Pipeline Handles the "Trust" Requirements

| Requirement | Implementation |
|-------------|----------------|
| No assumptions as verified truth | Claims default to `status: proposed`; confidence < 0.7 auto-flags as uncertain; missing evidence shown as gaps, not filled |
| No confidential exposure | Source ACLs propagate to claims; render-time redaction by role; audit log of every view |
| Correct/reject/approve | Review UI lets reviewers edit any claim; rejection removes node from approved snapshot; version history preserved |
| Validation gate before share | Automated validation runs after human review; citation integrity, contradictions, permissions, and completeness are re-checked; critical failures block publication |
| Synthetic/anonymised demo data | Demo mode generates fake repos, tickets, and Slack threads with PII replaced; clearly labelled as synthetic |

---

## Innovation Highlights

1. **Evidence-linked graph, not a document** — Every statement traces to a quote in a source. The incoming person can click through to the original PR, ticket, or message to verify context.
2. **Uncertainty as a first-class citizen** — Instead of hallucinating "the API is deprecated," the system says "two sources conflict; confidence 0.3; reviewer action required."
3. **Role-aware redaction at the claim level** — Permissions aren't bolted on at the end; they flow from source ACLs through to the rendered handover view.
4. **Continuation plan, not just a brain dump** — Output includes explicit next actions, owners, blockers, and dependencies — things the incoming person can act on day one.
5. **Immutable approval trail** — Who approved what, when, and which version the leaver signed off on — critical for compliance and accountability.

---

## MVP Scope (First Release)

- **Connectors:** GitHub, Slack, Jira/Linear, Markdown docs
- **Reconstruction:** decision detection, ownership, timeline, open questions
- **Review UI:** accept/reject/edit claims, version snapshot, approval
- **Validation gate:** citation integrity, contradiction re-scan, confidence recalculation, permission re-validation, completeness check
- **Handover view:** role-based rendering with citations and redaction
- **Demo:** synthetic project data (fake repo, tickets, chat) clearly marked synthetic

---

## Phase 2 — Broadened Source Coverage (Post-MVP)

- **Google Drive:** Docs, Sheets, Slides, and PDFs stored in Drive. Inherits folder/file ACLs; each item becomes a `Source` with content hash and access metadata.
- **AI meeting summaries:** Structured outputs from Zoom AI Companion, Google Meet summary, Fireflies.ai, tl;dv, or Otter.ai — decisions, action items, key points, and attendees. Stored as `MeetingSummary` sources with meeting ID, date, organizer, and attendee list.
- **Citation from meeting summaries:** Claims cite the meeting tool + metadata (e.g., "Fireflies.ai summary, Zoom meeting #88342, 2026-09-14, 14:00–14:45"). AI summaries are weighted as lower-authority sources in confidence scoring and are flagged for closer reviewer scrutiny.

### Data model additions (Phase 2)

| Entity | Fields |
|--------|--------|
| **MeetingSummary** | id, source_id, meeting_id, platform (zoom|meet|fireflies|otter|tl;dv), meeting_date, organizer, attendees, summary_text, key_points[], action_items[], decisions[], url |
| **DriveFile** | id, source_id, file_id, name, mime_type, owner, shared_with[], folder_path, inherited_acl, url |

### Trust considerations for Phase 2

- AI meeting summaries can hallucinate or misattribute decisions. Confidence scores for summary-derived claims start lower (e.g., max 0.6) and require corroboration from code, tickets, or docs to rise.
- Drive file permissions are inherited and granular. The validation gate (Layer 5) re-checks inherited ACLs before rendering any Drive-derived claim in a role-scoped view.
- Meeting summaries lose the *why* behind decisions (the debate that led to them). Reviewers should treat summary-derived claims as pointers to investigate, not final answers.

---

## Phase 3 — On-Demand Code Version Comparison (Post-MVP)

A user-initiated code diff between any two specified versions (e.g., compare v5 against v3). This is **not automatic** — the user selects the two versions they want to compare, and the system surfaces architecturally significant changes between them.

- **User-specified versions:** The reviewer or incoming person picks two tags, commits, or releases (e.g., `v5.2.0` vs `v3.1.0`). No version pairs are compared unless explicitly requested.
- **Semantic diff, not raw text:** Groups changes by PR, service, or module rather than showing every changed line. Surfaces new services, removed modules, API contract changes, dependency additions/removals, and major refactors.
- **Linked to decisions:** Each significant code change is linked to the PR, ticket, or ADR that authorized it, so the incoming person can see *why* the change happened, not just *what* changed.
- **Handover-relevant filtering:** Only shows changes that matter for continuity — ownership shifts, breaking API changes, new on-call responsibilities, deprecated patterns still in use.

### Data model additions (Phase 3)

| Entity | Fields |
|--------|--------|
| **CodeVersionComparison** | id, project_id, version_a, version_b, requested_by, requested_at, status (pending|completed|failed) |
| **CodeDiff** | id, comparison_id, file_path, change_type (added|modified|deleted), significance_score, linked_pr, linked_ticket, summary |

### Trust considerations for Phase 3

- A code diff shows *what* changed, not *why*. Without linking to PRs/tickets/ADRs, the diff is just noise. Every significant diff must carry a citation to its authorizing source.
- Comparing distant versions (e.g., v3 vs v6) can produce large diffs. The system should surface only architecturally significant changes and let the user drill down, rather than dumping thousands of lines.
- Code access follows repository ACLs. If the incoming person isn't authorized to view a repo, the comparison for that repo is redacted or blocked by the Layer 5 validation gate.

---

## Suggested Next Step

If you want to move from proposal to code, I'd recommend starting with **Layer 1 + 2**: build one connector (e.g., GitHub issues + PRs) and a simple graph extractor that turns issues/PRs into Decision/Task/Question nodes with citations. That validates the core innovation — evidence-linked reconstruction — before adding permissions and review UI.

Would you like me to scope out the first connector and graph schema in detail, or start scaffolding the project structure?
