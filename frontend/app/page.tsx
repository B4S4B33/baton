"use client";

import { useEffect, useState } from "react";

type Claim = {
  id: string;
  type: string;
  text: string;
  confidence?: number;
  status: string;
  sourceUrl?: string;
  sourceType?: string;
  sourceProvider?: string;
  sourceAuthority?: "low" | "high" | string | null;
  meetingId?: string | null;
  corroborated?: boolean;
  corroborationCount?: number;
  needsCorroboration?: boolean;
  createdAt?: string;
  author?: string;
  isLeaver?: boolean;
  body?: string;
  labels?: string[];
  assignees?: string[];
  reviewers?: string[];
  proof?: any;
  redacted?: boolean;
  redactionLevel?: "none" | "partial" | "full";
  redactionReason?: string | null;
};

type Stats = {
  totalPrs?: number;
  mergedPrs?: number;
  openPrs?: number;
  closedPrs?: number;
  totalIssues?: number;
  openIssues?: number;
  closedIssues?: number;
  totalComments?: number;
  leaverActivities?: number;
  totalClaims?: number;
  openCount?: number;
  mergedCount?: number;
  closedCount?: number;
  redactedCount?: number;
  claimTypes?: string[];
};

type ActionItem = Claim & { priority?: "high" | "medium" | "low" };
type Role = "developer" | "pm" | "new_hire";
type Acknowledgement = {
  handoverVersionId: string;
  role: Role;
  acknowledgedBy?: string | null;
  acknowledgedAt: string;
  notes?: string | null;
};

const ROLES: { role: Role; label: string; description: string }[] = [
  { role: "developer", label: "Developer", description: "Technical detail, code/review context, with sensitive values masked." },
  { role: "pm", label: "PM", description: "Status, decisions, risks, ownership, and blockers with low-level noise reduced." },
  { role: "new_hire", label: "New Hire", description: "Onboarding-focused summary with sensitive and low-level details hidden." },
];

export default function Home() {
  const [view, setView] = useState<"landing" | "dashboard">("landing");
  const [repoUrl, setRepoUrl] = useState("");
  const [leaverUsername, setLeaverUsername] = useState("");
  const [githubToken, setGithubToken] = useState("");
  const [claims, setClaims] = useState<Claim[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [actionItems, setActionItems] = useState<ActionItem[]>([]);
  const [leaverActivity, setLeaverActivity] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [validationResults, setValidationResults] = useState<any>(null);
  const [validationLoading, setValidationLoading] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const [selectedRole, setSelectedRole] = useState<Role>("developer");
  const [acknowledgements, setAcknowledgements] = useState<Acknowledgement[]>([]);
  const [ackBy, setAckBy] = useState("");
  const [ackNotes, setAckNotes] = useState("");
  const [ackLoading, setAckLoading] = useState(false);
  const [ackMessage, setAckMessage] = useState<string | null>(null);

  const extractRepo = (url: string): string | null => {
    const match = url.match(/github\.com\/([^\/]+)\/([^\/]+?)(?:\.git)?\/?$/);
    if (!match) return null;
    return `${match[1]}/${match[2]}`;
  };

  const loadRoleView = async (role: Role) => {
    const res = await fetch(`/api/handover/view?role=${encodeURIComponent(role)}&handoverVersionId=default`);
    let data: any = null;
    try { data = await res.json(); } catch { data = null; }
    if (!res.ok) throw new Error(data?.error || "Failed to load handover view");
    setClaims(Array.isArray(data.claims) ? data.claims : []);
    setStats(data.stats || null);
    setActionItems(Array.isArray(data.actionItems) ? data.actionItems : []);
    setLeaverActivity(data.leaverActivity || null);
    setAcknowledgements(Array.isArray(data.acknowledgements) ? data.acknowledgements : []);
    return data;
  };

  const handleIngest = async (e: React.FormEvent) => {
    e.preventDefault();
    const repo = extractRepo(repoUrl);
    if (!repo) { setError("Invalid GitHub repository URL. Use format: https://github.com/owner/repo"); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ingest/github", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo, leaverUsername: leaverUsername || undefined, token: githubToken || undefined }),
      });
      let data: any = null;
      try { data = await res.json(); } catch { data = null; }
      if (!res.ok) throw new Error(`Ingestion failed: ${data?.details || data?.detail || data?.error || res.statusText}`);
      setView("dashboard");
      await loadRoleView(selectedRole);
    } catch (e: any) {
      setError(e.message || "Failed to ingest data");
    } finally {
      setLoading(false);
    }
  };

  const runValidation = async () => {
    setValidationLoading(true);
    setValidationError(null);
    try {
      const res = await fetch("/api/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handoverVersionId: "default", roleId: selectedRole }),
      });
      if (!res.ok) throw new Error(`Validation failed: ${res.statusText}`);
      setValidationResults(await res.json());
    } catch (e: any) {
      setValidationError(e.message || "Validation failed");
    } finally {
      setValidationLoading(false);
    }
  };

  const submitAcknowledgement = async () => {
    setAckLoading(true);
    setAckMessage(null);
    try {
      const res = await fetch("/api/handover/acknowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handoverVersionId: "default", role: selectedRole, acknowledgedBy: ackBy || undefined, notes: ackNotes || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to acknowledge");
      setAcknowledgements(Array.isArray(data.acknowledgements) ? data.acknowledgements : acknowledgements);
      setAckMessage(`${ROLES.find((r) => r.role === selectedRole)?.label || selectedRole} view acknowledged.`);
    } catch (e: any) {
      setAckMessage(e.message || "Failed to acknowledge");
    } finally {
      setAckLoading(false);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const viewRes = await fetch(`/api/handover/view?role=${encodeURIComponent(selectedRole)}&handoverVersionId=default`);
        const data = await viewRes.json();
        if (viewRes.ok && ((data.claims && data.claims.length > 0) || (data.actionItems && data.actionItems.length > 0))) {
          setClaims(Array.isArray(data.claims) ? data.claims : []);
          setStats(data.stats || null);
          setActionItems(Array.isArray(data.actionItems) ? data.actionItems : []);
          setLeaverActivity(data.leaverActivity || null);
          setAcknowledgements(Array.isArray(data.acknowledgements) ? data.acknowledgements : []);
          setView("dashboard");
        }
      } catch {}
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (view !== "dashboard") return;
    loadRoleView(selectedRole).catch((e) => setError(e.message || "Failed to load role view"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRole, view]);

  const filteredClaims = claims.filter((c) => {
    if (filterStatus === "all") return true;
    if (filterStatus === "leaver") return c.isLeaver === true;
    return c.status === filterStatus;
  });

  const openCount = claims.filter((c) => c.status === "open" || c.status === "proposed").length;
  const mergedCount = claims.filter((c) => c.status === "merged").length;
  const closedCount = claims.filter((c) => c.status === "closed").length;
  const redactedCount = claims.filter((c) => c.redacted).length;
  const currentAck = acknowledgements.find((a) => a.role === selectedRole);
  const roleMeta = ROLES.find((r) => r.role === selectedRole)!;

  const priorityFor = (claim: Claim): "high" | "medium" | "low" => {
    if (claim.type === "open_pr" || claim.type === "open_issue") return "high";
    if (claim.type === "pr_review_comment" && claim.isLeaver) return "high";
    if (claim.status === "open" || claim.status === "proposed") return "medium";
    return "low";
  };

  const typeColor = (type: string) => ({
    merged_pr: "#10b981", open_pr: "#3b82f6", closed_pr: "#6b7280", open_issue: "#f59e0b", closed_issue: "#6b7280",
    pr_comment: "#8b5cf6", pr_review_comment: "#ec4899", issue_comment: "#06b6d4", decision: "#84cc16", task: "#f97316",
    risk: "#ef4444", dependency: "#14b8a6", question: "#a855f7", insight: "#0ea5e9",
  } as Record<string, string>)[type] || "#6b7280";

  const statusColor = (status: string) => ({
    merged: "#10b981", open: "#3b82f6", closed: "#6b7280", commented: "#8b5cf6", reviewed: "#ec4899", proposed: "#f59e0b", accepted: "#10b981",
  } as Record<string, string>)[status] || "#6b7280";

  const isMeetingSummaryClaim = (claim: Claim) =>
    claim.sourceType === "meeting_summary" || claim.proof?.type === "meeting_summary" || String(claim.sourceAuthority || "").toLowerCase() === "low";
  const isUncorroboratedLowAuthority = (claim: Claim) =>
    isMeetingSummaryClaim(claim) && !claim.corroborated && !(Number(claim.corroborationCount) > 0);
  const confidenceDisplay = (claim: Claim) => {
    if (typeof claim.confidence !== "number") return "-";
    const pct = `${(claim.confidence * 100).toFixed(0)}%`;
    if (isUncorroboratedLowAuthority(claim)) return `${pct} (capped ≤60%)`;
    return pct;
  };

  const Citation = ({ url }: { url?: string }) => url ? (
    <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: "#3b82f6", textDecoration: "none", fontSize: 12, fontWeight: 600 }}>View source</a>
  ) : <span style={{ color: "#94a3b8", fontSize: 12 }}>No citation</span>;

  if (view === "landing") {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0f172a" }}>
        <div style={{ background: "rgba(255,255,255,0.97)", borderRadius: 24, padding: 48, maxWidth: 560, width: "100%", boxShadow: "0 25px 50px -12px rgba(0,0,0,0.5)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
            <div style={{ width: 32, height: 32, background: "linear-gradient(135deg,#3b82f6,#8b5cf6)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontWeight: 700 }}>KH</div>
            <h1 style={{ fontSize: 28, fontWeight: 800, color: "#0f172a", margin: 0 }}>Knowledge Handover</h1>
          </div>
          <p style={{ color: "#64748b", marginBottom: 24, lineHeight: 1.6 }}>
            Role-scoped handover views (Developer, PM, New Hire) with claim-level redaction, clickable citations, and acknowledgement tracking.
          </p>
          <form onSubmit={handleIngest} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <label style={{ fontWeight: 600, color: "#334155", fontSize: 14 }}>Repository URL
              <input type="url" placeholder="https://github.com/owner/repo" value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} required style={{ width: "100%", marginTop: 8, padding: "14px 16px", border: "1px solid #cbd5e1", borderRadius: 10, boxSizing: "border-box" }} />
            </label>
            <label style={{ fontWeight: 600, color: "#334155", fontSize: 14 }}>Departing Member&apos;s GitHub Username (optional)
              <input type="text" placeholder="e.g. johndoe" value={leaverUsername} onChange={(e) => setLeaverUsername(e.target.value)} style={{ width: "100%", marginTop: 8, padding: "14px 16px", border: "1px solid #cbd5e1", borderRadius: 10, boxSizing: "border-box" }} />
            </label>
            <label style={{ fontWeight: 600, color: "#334155", fontSize: 14 }}>GitHub Token (optional)
              <input type="password" placeholder="ghp_..." value={githubToken} onChange={(e) => setGithubToken(e.target.value)} style={{ width: "100%", marginTop: 8, padding: "14px 16px", border: "1px solid #cbd5e1", borderRadius: 10, boxSizing: "border-box" }} />
            </label>
            {error && <div style={{ color: "#dc2626", background: "#fef2f2", padding: 12, borderRadius: 8, fontSize: 14 }}>{error}</div>}
            <button type="submit" disabled={loading} style={{ width: "100%", padding: 16, background: loading ? "#94a3b8" : "linear-gradient(135deg,#3b82f6,#8b5cf6)", color: "white", border: "none", borderRadius: 10, fontSize: 16, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer" }}>
              {loading ? "Ingesting project data..." : "Start Handover Analysis"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
      <header style={{ background: "linear-gradient(135deg,#0f172a 0%,#1e293b 100%)", color: "white", padding: "24px 32px" }}>
        <div style={{ maxWidth: 1400, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 40, height: 40, background: "linear-gradient(135deg,#3b82f6,#8b5cf6)", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>KH</div>
            <div>
              <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Knowledge Handover</h1>
              <p style={{ fontSize: 14, color: "#94a3b8", margin: 0 }}>Role-scoped view: {roleMeta.label}</p>
            </div>
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <button onClick={() => setView("landing")} style={{ background: "rgba(255,255,255,0.1)", color: "white", border: "1px solid rgba(255,255,255,0.2)", padding: "10px 20px", borderRadius: 8, fontWeight: 600, cursor: "pointer" }}>New Analysis</button>
            <button onClick={() => loadRoleView(selectedRole)} style={{ background: "#3b82f6", color: "white", border: "none", padding: "10px 20px", borderRadius: 8, fontWeight: 600, cursor: "pointer" }}>Refresh View</button>
            <button onClick={runValidation} disabled={validationLoading} style={{ background: validationLoading ? "#94a3b8" : "#10b981", color: "white", border: "none", padding: "10px 20px", borderRadius: 8, fontWeight: 600, cursor: validationLoading ? "not-allowed" : "pointer" }}>{validationLoading ? "Validating..." : "Run Validation"}</button>
          </div>
        </div>
      </header>

      <div style={{ maxWidth: 1400, margin: "0 auto", padding: 32 }}>
        {error && <div style={{ marginBottom: 16, color: "#dc2626", background: "#fef2f2", padding: 12, borderRadius: 8 }}>{error}</div>}
        {validationError && <div style={{ marginBottom: 16, color: "#dc2626", background: "#fef2f2", padding: 12, borderRadius: 8 }}>{validationError}</div>}

        <div style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 16, padding: 20, marginBottom: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
            <div>
              <h2 style={{ margin: "0 0 8px", fontSize: 18, color: "#0f172a" }}>Handover Views & Acknowledgement</h2>
              <p style={{ margin: 0, color: "#64748b", fontSize: 14 }}>{roleMeta.description}</p>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {ROLES.map((r) => (
                <button key={r.role} onClick={() => { setSelectedRole(r.role); setAckMessage(null); }} style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #cbd5e1", background: selectedRole === r.role ? "#3b82f6" : "white", color: selectedRole === r.role ? "white" : "#334155", fontWeight: 600, cursor: "pointer" }}>{r.label}</button>
              ))}
            </div>
          </div>
          <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            {ROLES.map((r) => {
              const ack = acknowledgements.find((a) => a.role === r.role);
              return (
                <div key={r.role} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 12, background: ack ? "#f0fdf4" : "#fff" }}>
                  <div style={{ fontWeight: 700, color: "#0f172a" }}>{r.label}</div>
                  <div style={{ fontSize: 13, color: ack ? "#15803d" : "#64748b", marginTop: 4 }}>{ack ? `Acknowledged ${new Date(ack.acknowledgedAt).toLocaleString()}` : "Not acknowledged"}</div>
                  {ack?.acknowledgedBy && <div style={{ fontSize: 12, color: "#475569", marginTop: 2 }}>By: {ack.acknowledgedBy}</div>}
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 16, borderTop: "1px solid #e2e8f0", paddingTop: 16, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, alignItems: "end" }}>
            <label style={{ fontSize: 13, color: "#334155", fontWeight: 600 }}>Acknowledge as (name, optional)
              <input value={ackBy} onChange={(e) => setAckBy(e.target.value)} placeholder="e.g. Alex" style={{ width: "100%", marginTop: 6, padding: "10px 12px", border: "1px solid #cbd5e1", borderRadius: 8, boxSizing: "border-box" }} />
            </label>
            <label style={{ fontSize: 13, color: "#334155", fontWeight: 600 }}>Notes (optional)
              <input value={ackNotes} onChange={(e) => setAckNotes(e.target.value)} placeholder="e.g. Ready to continue" style={{ width: "100%", marginTop: 6, padding: "10px 12px", border: "1px solid #cbd5e1", borderRadius: 8, boxSizing: "border-box" }} />
            </label>
            <div>
              <button onClick={submitAcknowledgement} disabled={ackLoading} style={{ padding: "10px 16px", borderRadius: 8, border: "none", background: ackLoading ? "#94a3b8" : "#0f766e", color: "white", fontWeight: 700, cursor: ackLoading ? "not-allowed" : "pointer", width: "100%" }}>
                {ackLoading ? "Saving..." : currentAck ? `Re-acknowledge ${roleMeta.label}` : `Acknowledge ${roleMeta.label} View`}
              </button>
              {ackMessage && <div style={{ marginTop: 8, fontSize: 13, color: "#334155" }}>{ackMessage}</div>}
            </div>
          </div>
        </div>

        {validationResults && (
          <div style={{ marginBottom: 24, padding: 16, background: validationResults.passed ? "#f0fdf4" : "#fef2f2", border: `1px solid ${validationResults.passed ? "#bbf7d0" : "#fecaca"}`, borderRadius: 12 }}>
            <div style={{ fontWeight: 700, color: "#0f172a", marginBottom: 8 }}>Validation Results: {validationResults.passed ? "Passed" : `${validationResults.criticalFailures?.length || 0} critical issue(s)`}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
              {(validationResults.results || []).map((r: any) => (
                <div key={r.id} style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 8, padding: 12 }}>
                  <div style={{ fontSize: 12, color: "#64748b", fontWeight: 700, textTransform: "uppercase" }}>{r.name}</div>
                  <div style={{ fontWeight: 700, color: r.status === "fail" || r.status === "warning" ? "#b45309" : "#15803d", margin: "4px 0" }}>{String(r.status).toUpperCase()}</div>
                  <div style={{ fontSize: 13, color: "#475569" }}>{r.detail}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16, marginBottom: 24 }}>
          {[
            { label: "Visible Claims", value: claims.length, color: "#3b82f6", sub: `${roleMeta.label} view` },
            { label: "Open/Proposed", value: stats?.openCount ?? openCount, color: "#f59e0b", sub: "Needs attention" },
            { label: "Merged/Closed", value: (stats?.mergedCount ?? mergedCount) + (stats?.closedCount ?? closedCount), color: "#10b981", sub: "Resolved history" },
            { label: "Redacted", value: stats?.redactedCount ?? redactedCount, color: "#ef4444", sub: "Claim-level redactions" },
            { label: "Action Items", value: actionItems.length, color: "#8b5cf6", sub: "Scoped to role" },
            { label: "Leaver Activities", value: leaverActivity?.totalActivities ?? stats?.leaverActivities ?? 0, color: "#ec4899", sub: "Visible to role" },
          ].map((s) => (
            <div key={s.label} style={{ background: "white", borderRadius: 14, padding: 16, border: "1px solid #f1f5f9" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>{s.label}</div>
              <div style={{ fontSize: 30, fontWeight: 800, color: s.color, margin: "6px 0" }}>{s.value}</div>
              <div style={{ fontSize: 13, color: "#94a3b8" }}>{s.sub}</div>
            </div>
          ))}
        </div>

        {leaverActivity && (leaverActivity.totalActivities || 0) > 0 && (
          <div style={{ background: "linear-gradient(135deg,#fdf2f8 0%,#fce7f3 100%)", border: "1px solid #fbcfe8", borderRadius: 16, padding: 20, marginBottom: 24 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: "#0f172a", margin: "0 0 4px" }}>Departing Member: {leaverActivity.leaverUsername || "Unknown"}</h2>
            <p style={{ fontSize: 14, color: "#64748b", margin: "0 0 12px" }}>{leaverActivity.totalActivities} visible activities in {roleMeta.label} view</p>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead><tr style={{ textAlign: "left", borderBottom: "2px solid #fbcfe8" }}><th style={{ padding: 10 }}>Type</th><th style={{ padding: 10 }}>Title</th><th style={{ padding: 10 }}>Citation</th><th style={{ padding: 10 }}>Redaction</th></tr></thead>
                <tbody>
                  {(leaverActivity.activities || []).slice(0, 8).map((a: Claim) => (
                    <tr key={a.id} style={{ borderBottom: "1px solid #fce7f3" }}>
                      <td style={{ padding: 10 }}>{a.type.replace(/_/g, " ").toUpperCase()}</td>
                      <td style={{ padding: 10, fontWeight: 600 }}>{a.text}</td>
                      <td style={{ padding: 10 }}><Citation url={a.sourceUrl} /></td>
                      <td style={{ padding: 10 }}>{a.redacted ? <span title={a.redactionReason || "Redacted"} style={{ color: "#b91c1c", fontWeight: 600 }}>Redacted</span> : "Visible"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: "#0f172a", margin: 0 }}>Action Items ({roleMeta.label})</h2>
            <span style={{ padding: "6px 12px", borderRadius: 20, background: "#fef2f2", color: "#dc2626", fontSize: 12, fontWeight: 700 }}>{actionItems.length} visible</span>
          </div>
          <div style={{ background: "white", borderRadius: 16, border: "1px solid #f1f5f9" }}>
            {actionItems.length === 0 ? <div style={{ padding: 32, textAlign: "center", color: "#64748b" }}>No action items visible for this role.</div> : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead><tr style={{ textAlign: "left", borderBottom: "2px solid #f1f5f9" }}><th style={{ padding: "14px 16px" }}>Priority</th><th style={{ padding: "14px 16px" }}>Task</th><th style={{ padding: "14px 16px" }}>Type</th><th style={{ padding: "14px 16px" }}>Citation</th><th style={{ padding: "14px 16px" }}>Redaction</th></tr></thead>
                  <tbody>
                    {actionItems.slice(0, 20).map((item) => {
                      const priority = item.priority || priorityFor(item);
                      return (
                        <tr key={item.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                          <td style={{ padding: "14px 16px" }}><span style={{ fontWeight: 700, color: priority === "high" ? "#dc2626" : priority === "medium" ? "#d97706" : "#15803d" }}>{priority.toUpperCase()}</span></td>
                          <td style={{ padding: "14px 16px", fontWeight: 600 }}>{item.text}</td>
                          <td style={{ padding: "14px 16px" }}>{item.type.replace(/_/g, " ").toUpperCase()}</td>
                          <td style={{ padding: "14px 16px" }}><Citation url={item.sourceUrl} /></td>
                          <td style={{ padding: "14px 16px" }}>{item.redacted ? <span title={item.redactionReason || "Redacted"} style={{ color: "#b91c1c", fontWeight: 600 }}>Redacted ({item.redactionLevel})</span> : "Visible"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div style={{ marginBottom: 40 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 12, flexWrap: "wrap" }}>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: "#0f172a", margin: 0 }}>Claims & Decisions ({roleMeta.label})</h2>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {[{ key: "all", label: `All (${claims.length})` }, { key: "open", label: `Open (${openCount})` }, { key: "merged", label: `Merged (${mergedCount})` }, { key: "leaver", label: "Leaver's Work" }].map((f) => (
                <button key={f.key} onClick={() => setFilterStatus(f.key)} style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid #cbd5e1", background: filterStatus === f.key ? "#3b82f6" : "white", color: filterStatus === f.key ? "white" : "#64748b", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>{f.label}</button>
              ))}
            </div>
          </div>
          <div style={{ background: "white", borderRadius: 16, border: "1px solid #f1f5f9", overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: "left", background: "#f8fafc", borderBottom: "2px solid #e2e8f0" }}>
                    <th style={{ padding: "14px 16px" }}>Claim</th>
                    <th style={{ padding: "14px 16px" }}>Type</th>
                    <th style={{ padding: "14px 16px" }}>Status</th>
                    <th style={{ padding: "14px 16px" }}>Confidence</th>
                    <th style={{ padding: "14px 16px" }}>Author</th>
                    <th style={{ padding: "14px 16px" }}>Citation</th>
                    <th style={{ padding: "14px 16px" }}>Redaction</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredClaims.slice(0, showAll ? undefined : 25).map((claim) => (
                    <tr key={claim.id} style={{ borderBottom: "1px solid #f1f5f9", verticalAlign: "top" }}>
                      <td style={{ padding: "14px 16px", color: "#334155", fontWeight: 600 }}>
                        <div>{claim.text}</div>
                        {claim.body && <div style={{ marginTop: 6, fontWeight: 400, color: "#475569", whiteSpace: "pre-wrap" }}>{claim.body.slice(0, 300)}{claim.body.length > 300 ? "..." : ""}</div>}
                        {claim.redactionReason && <div style={{ marginTop: 6, fontSize: 12, color: "#b91c1c" }}>{claim.redactionReason}</div>}
                      </td>
                      <td style={{ padding: "14px 16px" }}><span style={{ display: "inline-block", padding: "4px 8px", borderRadius: 6, background: `${typeColor(claim.type)}15`, color: typeColor(claim.type), fontSize: 11, fontWeight: 600 }}>{claim.type.replace(/_/g, " ").toUpperCase()}</span></td>
                      <td style={{ padding: "14px 16px" }}><span style={{ display: "inline-block", padding: "4px 8px", borderRadius: 6, background: `${statusColor(claim.status)}15`, color: statusColor(claim.status), fontSize: 11, fontWeight: 600 }}>{String(claim.status || "").toUpperCase()}</span></td>
                      <td style={{ padding: "14px 16px" }}>
                        <div>{confidenceDisplay(claim)}</div>
                        {isMeetingSummaryClaim(claim) && (
                          <div style={{ marginTop: 4, display: "flex", gap: 4, flexWrap: "wrap" }}>
                            <span title="AI meeting summaries are lower-authority sources" style={{ fontSize: 10, fontWeight: 700, color: "#92400e", background: "#fef3c7", border: "1px solid #fcd34d", padding: "2px 6px", borderRadius: 4 }}>
                              LOW AUTHORITY{claim.sourceProvider ? ` · ${String(claim.sourceProvider).toUpperCase()}` : ""}
                            </span>
                            {isUncorroboratedLowAuthority(claim) ? (
                              <span title="Confidence capped at 60% until corroborated by higher-authority or approved evidence" style={{ fontSize: 10, fontWeight: 700, color: "#991b1b", background: "#fee2e2", border: "1px solid #fecaca", padding: "2px 6px", borderRadius: 4 }}>
                                NEEDS CORROBORATION
                              </span>
                            ) : (
                              <span style={{ fontSize: 10, fontWeight: 700, color: "#166534", background: "#dcfce7", border: "1px solid #bbf7d0", padding: "2px 6px", borderRadius: 4 }}>
                                CORROBORATED
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: "14px 16px", color: "#64748b" }}>{claim.author || "Unknown"}{claim.isLeaver && <span style={{ marginLeft: 6, padding: "2px 6px", borderRadius: 4, background: "#ec4899", color: "white", fontSize: 10, fontWeight: 700 }}>LEAVER</span>}</td>
                      <td style={{ padding: "14px 16px" }}>
                        <Citation url={claim.sourceUrl} />
                        {claim.proof?.type && <div style={{ marginTop: 4, fontSize: 10, color: "#64748b", background: "#f8fafc", padding: "2px 6px", borderRadius: 4, display: "inline-block" }}>{String(claim.proof.type).replace(/_/g, " ").toUpperCase()}</div>}
                        {claim.sourceType === "meeting_summary" && <div style={{ marginTop: 4, fontSize: 10, color: "#92400e", background: "#fffbeb", padding: "2px 6px", borderRadius: 4, display: "inline-block" }}>MEETING SUMMARY</div>}
                      </td>
                      <td style={{ padding: "14px 16px" }}>{claim.redacted ? <span title={claim.redactionReason || "Redacted"} style={{ color: "#b91c1c", fontWeight: 700 }}>Redacted ({claim.redactionLevel || "partial"})</span> : <span style={{ color: "#15803d", fontWeight: 600 }}>Visible</span>}</td>
                    </tr>
                  ))}
                  {filteredClaims.length > 25 && !showAll && (
                    <tr><td colSpan={7} style={{ padding: 16, textAlign: "center" }}><button onClick={() => setShowAll(true)} style={{ padding: "8px 20px", background: "#f8fafc", color: "#3b82f6", border: "1px solid #cbd5e1", borderRadius: 8, fontWeight: 600, cursor: "pointer" }}>Show all {filteredClaims.length} claims</button></td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
