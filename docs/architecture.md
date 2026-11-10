# Knowledge Handover Platform — Architecture Diagrams

## 1. High-Level System Architecture

```mermaid
graph TB
    subgraph External_Sources [Authorised External Sources]
        GH[GitHub / GitLab]
        SL[Slack / Teams]
        JI[Jira / Linear / Trello]
        GD[Google Drive / SharePoint]
        MT[Zoom / Google Meet / Fireflies / Otter]
        MD[Markdown Docs]
    end

    subgraph Connectors [Ingestion Connectors]
        CG[GitHub Connector]
        CS[Slack Connector]
        CJ[Jira Connector]
        CD[Drive Connector]
        CM[Meeting Summary Connector]
    end

    subgraph Platform [Knowledge Handover Platform]
        API[FastAPI Backend API]
        AUTH[Authentication & RBAC<br/>Clerk / Auth0]
        WORKER[Celery Workers + Redis]
        NEO4J[(Neo4j<br/>Knowledge Graph)]
        PG[(PostgreSQL + pgvector<br/>Users, Roles, Versions, Audit)]
        MINIO[(MinIO / S3<br/>Raw Source Artifacts)]
        LLM[LLM Service<br/>LangChain + GPT-4o / Claude]
    end

    subgraph Frontend [Frontend]
        WEB[Next.js + TypeScript<br/>Handover Views, Review UI, Validation Dashboard]
    end

    External_Sources --> Connectors
    Connectors --> WORKER
    WORKER --> API
    API --> NEO4J
    API --> PG
    API --> MINIO
    API --> LLM
    LLM --> NEO4J
    WEB --> API
    AUTH --> API
    AUTH --> WEB
```

---

## 2. Component Architecture (C4-Style Container Diagram)

```mermaid
graph LR
    subgraph Client_Layer [Client Layer]
        Browser[Web Browser<br/>Next.js Frontend]
    end

    subgraph API_Layer [API Layer]
        Gateway[API Gateway / FastAPI]
        Auth[Auth Service]
        Claims[Claims Service]
        Graph[Graph Service]
        Validate[Validation Service]
        Ingest[Ingestion Service]
    end

    subgraph Data_Layer [Data Layer]
        Neo4j[(Neo4j<br/>Knowledge Graph)]
        Postgres[(PostgreSQL<br/>Relational + Vector)]
        Redis[(Redis<br/>Cache + Broker)]
        MinIO[(MinIO<br/>Object Storage)]
    end

    subgraph AI_Layer [AI Layer]
        Embedding[Embedding Model<br/>sentence-transformers]
        LLM[LLM<br/>GPT-4o / Claude]
    end

    subgraph External_Layer [External Sources]
        GitHub[GitHub API]
        Slack[Slack API]
        Jira[Jira API]
        Drive[Google Drive API]
        Meet[Meeting Summary APIs]
    end

    Browser --> Gateway
    Gateway --> Auth
    Gateway --> Claims
    Gateway --> Graph
    Gateway --> Validate
    Gateway --> Ingest

    Claims --> Postgres
    Graph --> Neo4j
    Validate --> Postgres
    Ingest --> Redis
    Ingest --> External_Layer

    Graph --> Embedding
    Graph --> LLM
    Claims --> Embedding

    External_Layer --> Ingest
```

---

## 3. Data Flow Diagram (Connect → Handover)

```mermaid
flowchart TD
    Start[Leaver's Project Activity] -->|Authorised access| Ingest[Ingest Sources<br/>GitHub, Slack, Jira, Drive, Meetings]
    
    Ingest --> Store[Store Raw Sources<br/>Content hash, ACL, timestamp]
    
    Store --> Extract[Extract Entities & Claims<br/>Decisions, tasks, dependencies, risks]
    
    Extract --> Link[Link Claims to Evidence<br/>Source fragments, citations, confidence scores]
    
    Link --> Detect[Detect Contradictions & Uncertainty<br/>Conflicting sources, missing evidence]
    
    Detect --> Review[Human Review Layer<br/>Accept, reject, edit claims]
    
    Review --> Validate[Automated Validation Gate<br/>Citation integrity, contradictions, permissions, completeness]
    
    Validate -->|Pass| Snapshot[Create Versioned Handover Snapshot]
    Validate -->|Fail| Review
    
    Snapshot --> Render[Render Role-Appropriate View<br/>Developer / PM / New Hire]
    
    Render --> Redact[Apply Claim-Level Redaction<br/>Based on incoming person's RBAC]
    
    Redact --> Share[Share Handover + Track Acknowledgement]
    
    style Start fill:#e1f5e1,stroke:#333
    style Share fill:#e1f5e1,stroke:#333
    style Review fill:#fff3cd,stroke:#333
    style Validate fill:#fff3cd,stroke:#333
```

---

## 4. Knowledge Graph Schema (Neo4j)

```mermaid
graph LR
    subgraph Nodes [Node Types]
        S[(Source<br/>URL, ACL, content_hash)]
        F[(Fragment<br/>Quote, offset, embedding)]
        C[(Claim<br/>decision, question, task,<br/>dependency, risk, contact)]
        H[(HandoverVersion<br/>draft, approved, superseded)]
        V[(ValidationResult<br/>pass, fail, warning)]
        R[(Role<br/>developer, PM, new_hire)]
    end

    subgraph Edges [Relationship Types]
        S -->|HAS_FRAGMENT| F
        F -->|SUPPORTS| C
        C -->|CONTRADICTS| C
        C -->|REFERENCES| C
        C -->|BELONGS_TO_VERSION| H
        H -->|HAS_VALIDATION| V
        H -->|RENDERED_AS_VIEW| R
        C -->|REDACTED_FOR_ROLE| R
    end

    style S fill:#e3f2fd,stroke:#333
    style C fill:#fff3e0,stroke:#333
    style H fill:#e8f5e9,stroke:#333
    style V fill:#fce4ec,stroke:#333
```

---

## 5. Deployment Architecture (Docker Compose / Kubernetes)

```mermaid
graph TB
    subgraph Ingress [Ingress / Load Balancer]
        LB[Nginx / Traefik]
    end

    subgraph App_Tier [Application Tier]
        API_Pod[API Pods<br/>FastAPI x2]
        WORKER_POD[Worker Pods<br/>Celery x2]
        WEB_POD[Frontend Pods<br/>Next.js x2]
    end

    subgraph Data_Tier [Data Tier]
        NEO4J_POD[Neo4j<br/>Single instance / cluster]
        PG_POD[PostgreSQL<br/>Primary + replica]
        REDIS_POD[Redis<br/>Cache + broker]
        MINIO_POD[MinIO<br/>Object storage]
    end

    subgraph Monitoring [Observability]
        SENTRY[Sentry<br/>Error tracking]
        PROM[Prometheus<br/>Metrics]
        GRAFANA[Grafana<br/>Dashboards]
    end

    LB --> API_Pod
    LB --> WEB_POD
    API_POD --> NEO4J_POD
    API_POD --> PG_POD
    API_POD --> REDIS_POD
    WORKER_POD --> NEO4J_POD
    WORKER_POD --> PG_POD
    WORKER_POD --> REDIS_POD
    WORKER_POD --> MINIO_POD

    API_POD --> SENTRY
    API_POD --> PROM
    WEB_POD --> SENTRY
    PROM --> GRAFANA
```

---

## 6. Connector Architecture (Pluggable)

```mermaid
graph TD
    IngestMgr[Ingestion Manager<br/>Celery Task Router]
    
    subgraph Connectors [Connector Plugins]
        GH[GitHub Connector<br/>REST + GraphQL API]
        SL[Slack Connector<br/>Slack API]
        JI[Jira Connector<br/>REST API]
        GD[Google Drive Connector<br/>Drive API]
        CM[Meeting Connector<br/>Zoom / Fireflies / Otter API]
    end
    
    subgraph Normalisation [Normalisation Layer]
        Norm[Source Normaliser<br/>Converts to common Source schema]
    end
    
    subgraph Storage [Storage]
        Neo4j[(Neo4j)]
        PG[(PostgreSQL)]
        MinIO[(MinIO)]
    end
    
    IngestMgr --> GH
    IngestMgr --> SL
    IngestMgr --> JI
    IngestMgr --> GD
    IngestMgr --> CM
    
    GH --> Norm
    SL --> Norm
    JI --> Norm
    GD --> Norm
    CM --> Norm
    
    Norm --> Neo4j
    Norm --> PG
    Norm --> MinIO
```

---

## Diagram Legend

| Color | Meaning |
|-------|---------|
| 🟢 Green | Start / End points (successful outcomes) |
| 🟡 Yellow | Human-in-the-loop steps (Review, Validation gate) |
| 🔵 Blue | Data sources and storage |
| ⚪ White | Application logic and services |
