# Knowledge Handover Platform — Workflow Diagrams

## 1. Core Handover Workflow (6 Layers)

```mermaid
flowchart LR
    subgraph Layer1 [Layer 1: Connect]
        L1[Connect<br/>Ingest authorised sources]
    end
    
    subgraph Layer2 [Layer 2: Reconstruct]
        L2[Reconstruct<br/>Build knowledge graph]
    end
    
    subgraph Layer3 [Layer 3: Verify]
        L3[Verify<br/>Link claims to evidence]
    end
    
    subgraph Layer4 [Layer 4: Review]
        L4[Review<br/>Human-in-the-loop]
    end
    
    subgraph Layer5 [Layer 5: Validate]
        L5[Validate<br/>Automated gate]
    end
    
    subgraph Layer6 [Layer 6: Handover]
        L6[Handover<br/>Role-appropriate view]
    end
    
    L1 --> L2 --> L3 --> L4 --> L5 --> L6
    
    style L1 fill:#e3f2fd,stroke:#333
    style L2 fill:#e3f2fd,stroke:#333
    style L3 fill:#e3f2fd,stroke:#333
    style L4 fill:#fff3cd,stroke:#333,stroke-width:2px
    style L5 fill:#fff3cd,stroke:#333,stroke-width:2px
    style L6 fill:#e8f5e9,stroke:#333
```

---

## 2. Detailed Workflow — From Source to Handover

```mermaid
flowchart TD
    Start([Start: Leaver Departure Detected])
    
    subgraph Connect [Connect Layer]
        C1[Select Sources<br/>GitHub, Slack, Jira, Drive, Meetings]
        C2[OAuth / Authorise Access]
        C3[Pull Data via Connectors]
        C4[Store as Source Records<br/>ACL + content hash + timestamp]
    end
    
    subgraph Reconstruct [Reconstruct Layer]
        R1[Entity Extraction<br/>People, services, APIs, tools]
        R2[Decision Detection<br/>ADRs, PR merges, "agreed" patterns]
        R3[Ownership Inference<br/>CODEOWNERS, git blame, assignees]
        R4[Timeline Assembly<br/>Chronological decision graph]
        R5[Dependency Mapping<br/>Imports, service calls, ticket links]
    end
    
    subgraph Verify [Verify Layer]
        V1[Link Claims to Source Fragments]
        V2[Assign Confidence Scores<br/>0.0–1.0]
        V3[Detect Contradictions<br/>Conflicting sources]
        V4[Flag Uncertainty<br/>Missing or low-confidence evidence]
    end
    
    subgraph Review [Review Layer - Human]
        RV1[Reviewer Opens Handover Draft]
        RV2[Accept / Reject / Edit Claims]
        RV3[Merge Duplicate Nodes]
        RV4[Add Manual Notes]
        RV5[Approve Versioned Snapshot]
    end
    
    subgraph Validate [Validate Layer - Automated Gate]
        VA1[Citation Integrity Check]
        VA2[Contradiction Re-scan]
        VA3[Confidence Recalculation]
        VA4[Permission Re-validation<br/>Claim-level ACL check]
        VA5[Completeness Check<br/>Ownership, blockers, next actions]
        VA6[Pass / Fail Gate]
    end
    
    subgraph Handover [Handover Layer]
        H1[Select Incoming Person's Role<br/>Developer / PM / New Hire]
        H2[Render Role-Appropriate View]
        H3[Apply Claim-Level Redaction]
        H4[Share Handover Package]
        H5[Track Acknowledgement of Receipt]
    end
    
    Start --> C1 --> C2 --> C3 --> C4
    C4 --> R1 --> R2 --> R3 --> R4 --> R5
    R5 --> V1 --> V2 --> V3 --> V4
    V4 --> RV1 --> RV2 --> RV3 --> RV4 --> RV5
    RV5 --> VA1 --> VA2 --> VA3 --> VA4 --> VA5 --> VA6
    
    VA6 -->|Fail| RV1
    VA6 -->|Pass| H1 --> H2 --> H3 --> H4 --> H5
    
    style Start fill:#e1f5e1,stroke:#333
    style H5 fill:#e1f5e1,stroke:#333
    style RV5 fill:#fff3cd,stroke:#333,stroke-width:2px
    style VA6 fill:#fff3cd,stroke:#333,stroke-width:2px
```

---

## 3. Sequence Diagram — Ingesting a New Source

```mermaid
sequenceDiagram
    actor User as Reviewer / Leaver
    participant API as FastAPI API
    participant Worker as Celery Worker
    participant Connector as Source Connector
    participant Neo4j as Neo4j Graph
    participant PG as PostgreSQL
    participant MinIO as MinIO / S3
    participant LLM as LLM Service

    User->>API: Authorise source (OAuth)
    API->>PG: Store OAuth token + ACL
    User->>API: Trigger ingestion for source
    API->>Worker: Enqueue ingest task
    Worker->>Connector: Fetch data (commits, issues, messages, etc.)
    Connector-->>Worker: Raw data + metadata
    Worker->>MinIO: Store raw artifact
    Worker->>PG: Create Source record (ACL, content_hash)
    Worker->>LLM: Extract entities & claims
    LLM-->>Worker: Claims + evidence fragments
    Worker->>Neo4j: Create Claim nodes + edges
    Worker->>Neo4j: Link Claims to Source Fragments
    Worker->>API: Ingestion complete
    API-->>User: Source ingested, claims proposed
```

---

## 4. Sequence Diagram — Review & Validate Handover

```mermaid
sequenceDiagram
    actor Reviewer as Responsible Person (Manager / Tech Lead)
    participant UI as Next.js Frontend
    participant API as FastAPI API
    participant Neo4j as Neo4j Graph
    participant PG as PostgreSQL
    participant Validate as Validation Service

    Reviewer->>UI: Open handover draft
    UI->>API: GET proposed claims + evidence
    API->>Neo4j: Query claims with citations
    Neo4j-->>API: Claims + source fragments + confidence
    API-->>UI: Handover draft view
    
    Reviewer->>UI: Edit / accept / reject claim
    UI->>API: UPDATE claim status
    API->>PG: Log audit entry (who, what, when, why)
    API->>Neo4j: Update claim node + edges
    API-->>UI: Claim updated
    
    Reviewer->>UI: Approve handover version
    UI->>API: POST approve version
    API->>Validate: Run validation gate
    Validate->>Neo4j: Check citation integrity
    Validate->>Neo4j: Re-scan contradictions
    Validate->>PG: Check claim-level ACLs
    Validate-->>API: Validation result (pass/fail)
    
    alt Validation Pass
        API->>Neo4j: Mark version as approved
        API->>PG: Create HandoverVersion snapshot
        API-->>UI: Handover approved
    else Validation Fail
        API-->>UI: Return validation errors
        Reviewer->>UI: Fix claims and re-submit
    end
```

---

## 5. Sequence Diagram — Role-Appropriate Handover Rendering

```mermaid
sequenceDiagram
    actor Incoming as Incoming Person (New Owner)
    participant UI as Next.js Frontend
    participant API as FastAPI API
    participant Neo4j as Neo4j Graph
    participant PG as PostgreSQL
    participant RBAC as RBAC Service

    Incoming->>UI: Request handover view
    UI->>API: GET handover + user role
    API->>PG: Verify user authentication & role
    API->>RBAC: Check claim-level permissions
    RBAC-->>API: Allowed claim IDs for role
    API->>Neo4j: Query approved claims (filtered by allowed IDs)
    Neo4j-->>API: Claims + citations + redactions
    API->>PG: Get validation history for version
    API-->>UI: Role-scoped handover view
    
    UI->>Incoming: Render view with citations
    Incoming->>UI: Click citation link
    UI->>API: GET source fragment + URL
    API-->>UI: Source reference (PR, ticket, meeting summary)
    UI->>Incoming: Display supporting evidence
    
    Incoming->>UI: Acknowledge receipt
    UI->>API: POST acknowledgement
    API->>PG: Record acknowledgement (user, timestamp, role)
    API-->>UI: Acknowledgement recorded
```

---

## 6. Validation Gate Decision Flow

```mermaid
flowchart TD
    Start([Validation Gate Triggered])
    
    V1[Citation Integrity:<br/>Every claim references live source?]
    V1 -->|No| Fail1[Flag orphaned claim]
    V1 -->|Yes| V2
    
    V2[Contradiction Re-scan:<br/>New conflicts after edits?]
    V2 -->|Yes| Fail2[Flag conflicting claims]
    V2 -->|No| V3
    
    V3[Confidence Recalculation:<br/>Any claim below threshold?]
    V3 -->|Yes| Warn1[Warning: low confidence]
    V3 -->|No| V4
    
    V4[Permission Re-validation:<br/>Claim-level ACL check for role?]
    V4 -->|No| Fail3[Block: unauthorised content]
    V4 -->|Yes| V5
    
    V5[Completeness Check:<br/>Ownership, blockers, next actions covered?]
    V5 -->|No| Warn2[Warning: gaps in coverage]
    V5 -->|Yes| V6
    
    V6[All Critical Rules Pass?]
    V6 -->|Yes| Approve[✅ Handover Approved for Sharing]
    V6 -->|No| Review[⚠️ Return to Reviewer]
    
    Fail1 --> Review
    Fail2 --> Review
    Fail3 --> Review
    Warn1 --> V4
    Warn2 --> V4
    
    style Start fill:#e1f5e1,stroke:#333
    style Approve fill:#e1f5e1,stroke:#333
    style Review fill:#fff3cd,stroke:#333,stroke-width:2px
    style Fail1 fill:#ffebee,stroke:#333
    style Fail2 fill:#ffebee,stroke:#333
    style Fail3 fill:#ffebee,stroke:#333
```

---

## 7. Phase 3 — On-Demand Code Version Comparison Workflow

```mermaid
flowchart TD
    Start([User Requests Code Comparison])
    
    S1[Select Version A<br/>Tag / commit / release]
    S2[Select Version B<br/>Tag / commit / release]
    S3[Confirm Comparison Scope<br/>All repos or specific services]
    
    S3 --> D1[Fetch Diffs from Git Provider<br/>GitHub/GitLab API]
    D1 --> D2[Group Changes by PR / Service / Module]
    D2 --> D3[Filter Architecturally Significant Changes<br/>New services, removed modules, API contracts]
    D3 --> D4[Link Changes to Authorizing Sources<br/>PR, ticket, ADR citations]
    D4 --> D5[Apply Repo ACLs<br/>Redact if incoming person unauthorised]
    D5 --> D6[Render Comparison View<br/>Side-by-side with citations]
    
    S1 --> S2 --> S3 --> D1 --> D2 --> D3 --> D4 --> D5 --> D6
    
    style Start fill:#e3f2fd,stroke:#333
    style D6 fill:#e8f5e9,stroke:#333
```

---

## Diagram Usage

These Mermaid diagrams can be rendered in:
- **GitHub** (native Mermaid support in `.md` files)
- **Notion** (Mermaid blocks)
- **Obsidian** (Mermaid plugin)
- **Mermaid Live Editor** (https://mermaid.live)

Each diagram is self-contained in its code block and can be copied directly into documentation or a wiki.