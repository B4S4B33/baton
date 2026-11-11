"use client";

import { useEffect, useState } from "react";

type Claim = {
  id: string;
  type: string;
  text: string;
  confidence: number;
  status: string;
  sourceUrl: string;
  sourceType: string;
  createdAt: string;
  author?: string;
  isLeaver?: boolean;
  body?: string;
  labels?: string[];
  assignees?: string[];
  reviewers?: string[];
  parentPr?: number;
  parentPrTitle?: string;
  parentIssue?: number;
  parentIssueTitle?: string;
  proof?: any;
};

type Stats = {
  totalPrs: number;
  mergedPrs: number;
  openPrs: number;
  closedPrs: number;
  totalIssues: number;
  openIssues: number;
  closedIssues: number;
  totalComments: number;
  leaverActivities: number;
};

type ActionItem = {
  id: string;
  type: string;
  text: string;
  status: string;
  sourceUrl: string;
  sourceType: string;
  priority: "high" | "medium" | "low";
};

export default function Home() {
  const [view, setView] = useState<"landing" | "dashboard">("landing");
  const [repoUrl, setRepoUrl] = useState("");
  const [leaverUsername, setLeaverUsername] = useState("");
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

  const extractRepo = (url: string): string | null => {
    const match = url.match(/github\.com\/([^\/]+)\/([^\/]+?)(?:\.git)?\/?$/);
    if (!match) return null;
    return `${match[1]}/${match[2]}`;
  };

  const handleIngest = async (e: React.FormEvent) => {
    e.preventDefault();
    const repo = extractRepo(repoUrl);
    if (!repo) {
      setError("Invalid GitHub repository URL");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/ingest/github", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo, leaverUsername: leaverUsername || undefined }),
      });

      if (!res.ok) throw new Error(`Ingestion failed: ${res.statusText}`);

      const data = await res.json();
      setStats(data.stats);
      setClaims(data.claims);
      setView("dashboard");

      // Fetch action items
      const actionRes = await fetch("/api/action-items");
      const actionData = await actionRes.json();
      setActionItems(actionData.actionItems);

      // Fetch leaver activity
      if (leaverUsername) {
        const leaverRes = await fetch("/api/leaver-activity");
        const leaverData = await leaverRes.json();
        setLeaverActivity(leaverData);
      }
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
        body: JSON.stringify({ handoverVersionId: "default" }),
      });
      if (!res.ok) throw new Error(`Validation failed: ${res.statusText}`);
      const data = await res.json();
      setValidationResults(data);
    } catch (e: any) {
      setValidationError(e.message || "Validation failed");
    } finally {
      setValidationLoading(false);
    }
  };

  useEffect(() => {
    // Load existing claims on mount
    const loadClaims = async () => {
      try {
        const res = await fetch("/api/claims");
        const data = await res.json();
        if (data.claims && data.claims.length > 0) {
          setClaims(data.claims);
          setStats(data.stats);
          setView("dashboard");
        }
      } catch {
        // Ignore - no existing data
      }
    };
    loadClaims();
  }, []);

  const filteredClaims = claims.filter((c) => {
    if (filterStatus === "all") return true;
    if (filterStatus === "leaver") return c.isLeaver === true;
    return c.status === filterStatus;
  });

  const openCount = claims.filter((c) => c.status === "open").length;
  const mergedCount = claims.filter((c) => c.status === "merged").length;
  const closedCount = claims.filter((c) => c.status === "closed").length;

  const priorityFor = (claim: Claim): "high" | "medium" | "low" => {
    if (claim.type === "open_pr" || claim.type === "open_issue") return "high";
    if (claim.type === "pr_review_comment" && claim.isLeaver) return "high";
    if (claim.status === "open") return "medium";
    return "low";
  };

  const typeColor = (type: string) => {
    const colors: Record<string, string> = {
      merged_pr: "#10b981",
      open_pr: "#3b82f6",
      closed_pr: "#6b7280",
      open_issue: "#f59e0b",
      closed_issue: "#6b7280",
      pr_comment: "#8b5cf6",
      pr_review_comment: "#ec4899",
      issue_comment: "#06b6d4",
      decision: "#84cc16",
      task: "#f97316",
    };
    return colors[type] || "#6b7280";
  };

  const statusColor = (status: string) => {
    const colors: Record<string, string> = {
      merged: "#10b981",
      open: "#3b82f6",
      closed: "#6b7280",
      commented: "#8b5cf6",
      reviewed: "#ec4899",
    };
    return colors[status] || "#6b7280";
  };

  if (view === "landing") {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#0f172a" }}>
        <div
          style={{
            background: "rgba(255, 255, 255, 0.95)",
            borderRadius: "24px",
            padding: "48px",
            maxWidth: "560px",
            boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)",
            border: "1px solid rgba(255, 255, 255, 0.2)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
            <div
              style={{
                width: "32px",
                height: "32px",
                background: "linear-gradient(135deg, #3b82f6, #8b5cf6)",
                borderRadius: "8px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "white",
                fontWeight: "bold",
                fontSize: "16px",
              }}
            >
              KH
            </div>
            <h1 style={{ fontSize: "28px", fontWeight: "800", color: "#0f172a", margin: 0 }}>
              Knowledge Handover
            </h1>
          </div>
          <p style={{ color: "#64748b", marginBottom: "32px", lineHeight: 1.6 }}>
            Convert scattered project activity into a structured handover when a team member leaves.
            Enter the repository URL and the departing member's GitHub username.
          </p>

          <form onSubmit={handleIngest} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div>
              <label style={{ display: "block", fontWeight: "600", color: "#334155", marginBottom: "8px", fontSize: "14px" }}>
                Repository URL
              </label>
              <input
                type="url"
                placeholder="https://github.com/owner/repo"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                required
                style={{
                  width: "100%",
                  padding: "14px 16px",
                  border: "1px solid #cbd5e1",
                  borderRadius: "10px",
                  fontSize: "14px",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
            </div>

            <div>
              <label style={{ display: "block", fontWeight: "600", color: "#334155", marginBottom: "8px", fontSize: "14px" }}>
                Departing Member's GitHub Username (optional)
              </label>
              <input
                type="text"
                placeholder="e.g. johndoe"
                value={leaverUsername}
                onChange={(e) => setLeaverUsername(e.target.value)}
                style={{
                  width: "100%",
                  padding: "14px 16px",
                  border: "1px solid #cbd5e1",
                  borderRadius: "10px",
                  fontSize: "14px",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
            </div>

            {error && (
              <div style={{ color: "#dc2626", background: "#fef2f2", padding: "12px", borderRadius: "8px", fontSize: "14px" }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{
                width: "100%",
                padding: "16px",
                background: loading ? "#94a3b8" : "linear-gradient(135deg, #3b82f6, #8b5cf6)",
                color: "white",
                border: "none",
                borderRadius: "10px",
                fontSize: "16px",
                fontWeight: "700",
                cursor: loading ? "not-allowed" : "pointer",
                transition: "transform 0.2s",
              }}
              onMouseEnter={(e) => { if (!loading) (e.currentTarget as HTMLElement).style.transform = "scale(1.02)"; }}
              onMouseLeave={(e) => { if (!loading) (e.currentTarget as HTMLElement).style.transform = "scale(1)"; }}
            >
              {loading ? "Ingesting project data..." : "Start Handover Analysis"}
            </button>
          </form>

          <div style={{ marginTop: "32px", paddingTop: "24px", borderTop: "1px solid #e2e8f0" }}>
            <h3 style={{ fontSize: "16px", fontWeight: "700", color: "#334155", marginBottom: "12px" }}>
              What gets analyzed:
            </h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "12px" }}>
              <div style={{ background: "#f8fafc", padding: "12px", borderRadius: "8px", fontSize: "13px", color: "#475569" }}>
                • All PRs (open, merged, closed)
              </div>
              <div style={{ background: "#f8fafc", padding: "12px", borderRadius: "8px", fontSize: "13px", color: "#475569" }}>
                • All issues (open, closed)
              </div>
              <div style={{ background: "#f8fafc", padding: "12px", borderRadius: "8px", fontSize: "13px", color: "#475569" }}>
                • PR & issue comments
              </div>
              <div style={{ background: "#f8fafc", padding: "12px", borderRadius: "8px", fontSize: "13px", color: "#475569" }}>
                • Leaver's activity trail
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Dashboard View
  return (
    <div className="min-h-screen" style={{ background: "#f8fafc", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
      {/* Header */}
      <header
        style={{
          background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
          color: "white",
          padding: "24px 32px",
          boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
        }}
      >
        <div style={{ maxWidth: "1400px", margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div
              style={{
                width: "40px",
                height: "40px",
                background: "linear-gradient(135deg, #3b82f6, #8b5cf6)",
                borderRadius: "10px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "white",
                fontWeight: "bold",
                fontSize: "18px",
              }}
            >
              KH
            </div>
            <div>
              <h1 style={{ fontSize: "22px", fontWeight: "700", margin: 0 }}>Knowledge Handover</h1>
              <p style={{ fontSize: "14px", color: "#94a3b8", margin: 0 }}>
                Project reconstruction &amp; continuation plan
              </p>
            </div>
          </div>
          <div style={{ display: "flex", gap: "12px" }}>
            <button
              onClick={() => setView("landing")}
              style={{
                background: "rgba(255, 255, 255, 0.1)",
                color: "white",
                border: "1px solid rgba(255, 255, 255, 0.2)",
                padding: "10px 20px",
                borderRadius: "8px",
                fontSize: "14px",
                fontWeight: "600",
                cursor: "pointer",
              }}
            >
              New Analysis
            </button>
            <button
              onClick={() => window.location.reload()}
              style={{
                background: "#3b82f6",
                color: "white",
                border: "none",
                padding: "10px 20px",
                borderRadius: "8px",
                fontSize: "14px",
                fontWeight: "600",
                cursor: "pointer",
              }}
            >
              Refresh Data
            </button>
            <button
              onClick={runValidation}
              disabled={validationLoading}
              style={{
                background: validationLoading ? "#94a3b8" : "#10b981",
                color: "white",
                border: "none",
                padding: "10px 20px",
                borderRadius: "8px",
                fontSize: "14px",
                fontWeight: "600",
                cursor: validationLoading ? "not-allowed" : "pointer",
              }}
            >
              {validationLoading ? "Validating..." : "Run Validation"}
            </button>
          </div>
        </div>
      </header>

      {/* Validation Results */}
      {validationResults && (
        <div
          style={{
            maxWidth: "1400px",
            margin: "0 auto",
            padding: "0 32px 24px",
            background: validationResults.passed ? "#f0fdf4" : "#fef2f2",
            border: `1px solid ${validationResults.passed ? "#bbf7d0" : "#fecaca"}`,
            borderRadius: "12px",
            marginBottom: "32px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "12px" }}>
            <div
              style={{
                width: "32px",
                height: "32px",
                background: validationResults.passed ? "#10b981" : "#f59e0b",
                borderRadius: "8px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "white",
                fontWeight: "bold",
              }}
            >
              {validationResults.passed ? "✓" : "⚠"}
            </div>
            <div>
              <h2 style={{ fontSize: "18px", fontWeight: "700", color: "#0f172a", margin: 0 }}>
                Validation Results
              </h2>
              <p style={{ fontSize: "14px", color: "#64748b", margin: "4px 0 0" }}>
                {validationResults.passed
                  ? "All checks passed. Handover is ready to share."
                  : `${validationResults.criticalFailures?.length || 0} critical issue(s) found. Review before sharing.`}
              </p>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "12px" }}>
            {validationResults.results.map((r: any) => (
              <div
                key={r.id}
                style={{
                  background: "white",
                  borderRadius: "8px",
                  padding: "16px",
                  border: `1px solid ${r.status === "fail" ? "#fecaca" : "#bbf7d0"}`,
                }}
              >
                <div style={{ fontSize: "12px", fontWeight: "600", color: "#64748b", textTransform: "uppercase" }}>
                  {r.name}
                </div>
                <div
                  style={{
                    fontSize: "14px",
                    fontWeight: "700",
                    color: r.status === "fail" ? "#dc2626" : "#15803d",
                    margin: "8px 0",
                  }}
                >
                  {r.status.toUpperCase()}
                </div>
                <div style={{ fontSize: "13px", color: "#475569" }}>{r.detail}</div>
              </div>
            ))}
          </div>
          {(() => {
            const contradictionResult = validationResults.results.find(
              (r: any) => r.type === "contradiction"
            );
            const hasContradictions = contradictionResult && contradictionResult.contradictions && contradictionResult.contradictions.length > 0;
            if (!hasContradictions) return null;
            return (
              <div style={{ marginTop: "16px", background: "#fffbeb", border: "1px solid #fde047", borderRadius: "8px", padding: "16px" }}>
                <div style={{ fontSize: "14px", fontWeight: "700", color: "#713f12", marginBottom: "8px" }}>
                  ⚠ Contradictions Detected
                </div>
                {contradictionResult.contradictions.map((c: any) => (
                  <div
                    key={`${c.claimAId}-${c.claimBId}`}
                    style={{
                      background: "white",
                      borderRadius: "6px",
                      padding: "12px",
                      marginBottom: "8px",
                      fontSize: "13px",
                    }}
                  >
                    <div style={{ fontWeight: "600", color: "#0f172a" }}>{c.claimAText}</div>
                    <div style={{ color: "#64748b", fontSize: "12px", margin: "4px 0" }}>{c.claimBText}</div>
                    <div style={{ fontSize: "11px", color: "#713f12" }}>{c.explanation}</div>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      )}

      <div style={{ maxWidth: "1400px", margin: "0 auto", padding: "32px" }}>
        {/* Stats Row */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "20px", marginBottom: "32px" }}>
          {[
            { label: "Total PRs", value: stats?.totalPrs || 0, color: "#3b82f6", sub: "Pull requests analyzed" },
            { label: "Merged", value: stats?.mergedPrs || 0, color: "#10b981", sub: "Successfully merged" },
            { label: "Open PRs", value: stats?.openPrs || 0, color: "#f59e0b", sub: "Needs attention" },
            { label: "Issues", value: stats?.totalIssues || 0, color: "#8b5cf6", sub: "Open & closed" },
            { label: "Comments", value: stats?.totalComments || 0, color: "#06b6d4", sub: "Discussion threads" },
            { label: "Leaver Actions", value: stats?.leaverActivities || 0, color: "#ec4899", sub: "By departing member" },
          ].map((stat) => (
            <div
              key={stat.label}
              style={{
                background: "white",
                borderRadius: "16px",
                padding: "20px",
                boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.05)",
                border: "1px solid #f1f5f9",
              }}
            >
              <div style={{ fontSize: "12px", fontWeight: "600", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                {stat.label}
              </div>
              <div style={{ fontSize: "32px", fontWeight: "800", color: stat.color, margin: "8px 0" }}>
                {stat.value}
              </div>
              <div style={{ fontSize: "13px", color: "#94a3b8" }}>{stat.sub}</div>
            </div>
          ))}
        </div>

        {/* Leaver Activity Section */}
        {leaverActivity && leaverActivity.totalActivities > 0 && (
          <div
            style={{
              background: "linear-gradient(135deg, #fdf2f8 0%, #fce7f3 100%)",
              border: "1px solid #fbcfe8",
              borderRadius: "16px",
              padding: "24px",
              marginBottom: "32px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px" }}>
              <div
                style={{
                  width: "36px",
                  height: "36px",
                  background: "#ec4899",
                  borderRadius: "10px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "white",
                  fontWeight: "bold",
                }}
              >
                👤
              </div>
              <div>
                <h2 style={{ fontSize: "18px", fontWeight: "700", color: "#0f172a", margin: 0 }}>
                  Departing Member: {leaverActivity.leaverUsername || "Unknown"}
                </h2>
                <p style={{ fontSize: "14px", color: "#64748b", margin: "4px 0 0" }}>
                  {leaverActivity.totalActivities} activities traced across PRs, issues &amp; comments
                </p>
              </div>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                <thead>
                  <tr style={{ textAlign: "left", borderBottom: "2px solid #fbcfe8" }}>
                    <th style={{ padding: "10px", color: "#be185d", fontWeight: "700" }}>Type</th>
                    <th style={{ padding: "10px", color: "#be185d", fontWeight: "700" }}>Title</th>
                    <th style={{ padding: "10px", color: "#be185d", fontWeight: "700" }}>Status</th>
                    <th style={{ padding: "10px", color: "#be185d", fontWeight: "700" }}>Date</th>
                    <th style={{ padding: "10px", color: "#be185d", fontWeight: "700" }}>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {leaverActivity.activities.slice(0, 8).map((a: Claim) => (
                    <tr key={a.id} style={{ borderBottom: "1px solid #fce7f3" }}>
                      <td style={{ padding: "10px", color: "#334155" }}>
                        <span
                          style={{
                            display: "inline-block",
                            padding: "4px 8px",
                            borderRadius: "6px",
                            background: "rgba(236, 72, 153, 0.1)",
                            color: "#be185d",
                            fontSize: "11px",
                            fontWeight: "600",
                          }}
                        >
                          {a.type.replace(/_/g, " ").toUpperCase()}
                        </span>
                      </td>
                      <td style={{ padding: "10px", color: "#334155", fontWeight: "600" }}>
                        {a.text}
                      </td>
                      <td style={{ padding: "10px", color: "#334155" }}>
                        <span
                          style={{
                            display: "inline-block",
                            padding: "4px 8px",
                            borderRadius: "6px",
                            background: "rgba(16, 185, 129, 0.1)",
                            color: "#15803d",
                            fontSize: "11px",
                            fontWeight: "600",
                          }}
                        >
                          {a.status}
                        </span>
                      </td>
                      <td style={{ padding: "10px", color: "#64748b" }}>
                        {new Date(a.createdAt).toLocaleDateString()}
                      </td>
                      <td style={{ padding: "10px", color: "#334155" }}>
                        <a
                          href={a.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: "#3b82f6", textDecoration: "none", fontSize: "12px" }}
                        >
                          View Source →
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {leaverActivity.activities.length > 8 && (
                <p style={{ marginTop: "12px", fontSize: "13px", color: "#64748b" }}>
                  Showing 8 of {leaverActivity.activities.length} leaver activities
                </p>
              )}
            </div>
          </div>
        )}

        {/* Action Items Section */}
        <div style={{ marginBottom: "32px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <h2 style={{ fontSize: "20px", fontWeight: "700", color: "#0f172a", margin: 0 }}>
              Immediate Action Items
            </h2>
            <span
              style={{
                display: "inline-block",
                padding: "6px 12px",
                borderRadius: "20px",
                background: "#fef2f2",
                color: "#dc2626",
                fontSize: "12px",
                fontWeight: "700",
              }}
            >
              {actionItems.length} items need attention
            </span>
          </div>
          <div
            style={{
              background: "white",
              borderRadius: "16px",
              boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.05)",
              border: "1px solid #f1f5f9",
            }}
          >
            {actionItems.length === 0 ? (
              <div style={{ padding: "40px", textAlign: "center", color: "#64748b" }}>
                No immediate action items. All caught up! ✅
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                  <thead>
                    <tr style={{ textAlign: "left", borderBottom: "2px solid #f1f5f9" }}>
                      <th style={{ padding: "14px 16px", color: "#64748b", fontWeight: "700", fontSize: "12px" }}>
                        Priority
                      </th>
                      <th style={{ padding: "14px 16px", color: "#64748b", fontWeight: "700", fontSize: "12px" }}>
                        Task
                      </th>
                      <th style={{ padding: "14px 16px", color: "#64748b", fontWeight: "700", fontSize: "12px" }}>
                        Type
                      </th>
                      <th style={{ padding: "14px 16px", color: "#64748b", fontWeight: "700", fontSize: "12px" }}>
                        Source
                      </th>
                      <th style={{ padding: "14px 16px", color: "#64748b", fontWeight: "700", fontSize: "12px" }}>
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {actionItems.slice(0, 10).map((item) => (
                      <tr key={item.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "14px 16px", color: "#334155" }}>
                          <span
                            style={{
                              display: "inline-block",
                              padding: "4px 8px",
                              borderRadius: "6px",
                              background:
                                item.priority === "high"
                                  ? "rgba(239, 68, 68, 0.1)"
                                  : item.priority === "medium"
                                  ? "rgba(245, 158, 11, 0.1)"
                                  : "rgba(16, 185, 129, 0.1)",
                              color:
                                item.priority === "high"
                                  ? "#dc2626"
                                  : item.priority === "medium"
                                  ? "#d97706"
                                  : "#15803d",
                              fontSize: "11px",
                              fontWeight: "700",
                            }}
                          >
                            {item.priority.toUpperCase()}
                          </span>
                        </td>
                        <td style={{ padding: "14px 16px", color: "#334155", fontWeight: "600" }}>
                          {item.text}
                        </td>
                        <td style={{ padding: "14px 16px", color: "#334155" }}>
                          <span
                            style={{
                              display: "inline-block",
                              padding: "4px 8px",
                              borderRadius: "6px",
                              background: "rgba(59, 130, 246, 0.1)",
                              color: "#2563eb",
                              fontSize: "11px",
                              fontWeight: "600",
                            }}
                          >
                            {item.type.replace(/_/g, " ").toUpperCase()}
                          </span>
                        </td>
                        <td style={{ padding: "14px 16px", color: "#64748b" }}>
                          <a
                            href={item.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: "#3b82f6", textDecoration: "none", fontSize: "12px" }}
                          >
                            View →
                          </a>
                        </td>
                        <td style={{ padding: "14px 16px", color: "#334155" }}>
                          <button
                            onClick={() => {
                              fetch(`/api/claims/${item.id}`, {
                                method: "PATCH",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ status: "accepted" }),
                              });
                              setClaims(claims.map((c) => (c.id === item.id ? { ...c, status: "accepted" } : c)));
                              setActionItems(actionItems.map((a) => (a.id === item.id ? { ...a, status: "accepted" } : a)));
                            }}
                            style={{
                              padding: "6px 12px",
                              background: "#10b981",
                              color: "white",
                              border: "none",
                              borderRadius: "6px",
                              fontSize: "12px",
                              fontWeight: "600",
                              cursor: "pointer",
                            }}
                          >
                            Mark Done
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Claims Dashboard */}
        <div style={{ marginBottom: "40px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <h2 style={{ fontSize: "20px", fontWeight: "700", color: "#0f172a", margin: 0 }}>
              All Claims &amp; Decisions
            </h2>
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                onClick={() => setFilterStatus("all")}
                style={{
                  padding: "6px 14px",
                  borderRadius: "8px",
                  border: "1px solid #cbd5e1",
                  background: filterStatus === "all" ? "#3b82f6" : "white",
                  color: filterStatus === "all" ? "white" : "#64748b",
                  fontSize: "12px",
                  fontWeight: "600",
                  cursor: "pointer",
                }}
              >
                All ({claims.length})
              </button>
              <button
                onClick={() => setFilterStatus("open")}
                style={{
                  padding: "6px 14px",
                  borderRadius: "8px",
                  border: "1px solid #cbd5e1",
                  background: filterStatus === "open" ? "#3b82f6" : "white",
                  color: filterStatus === "open" ? "white" : "#64748b",
                  fontSize: "12px",
                  fontWeight: "600",
                  cursor: "pointer",
                }}
              >
                Open ({openCount})
              </button>
              <button
                onClick={() => setFilterStatus("merged")}
                style={{
                  padding: "6px 14px",
                  borderRadius: "8px",
                  border: "1px solid #cbd5e1",
                  background: filterStatus === "merged" ? "#3b82f6" : "white",
                  color: filterStatus === "merged" ? "white" : "#64748b",
                  fontSize: "12px",
                  fontWeight: "600",
                  cursor: "pointer",
                }}
              >
                Merged ({mergedCount})
              </button>
              <button
                onClick={() => setFilterStatus("leaver")}
                style={{
                  padding: "6px 14px",
                  borderRadius: "8px",
                  border: "1px solid #cbd5e1",
                  background: filterStatus === "leaver" ? "#3b82f6" : "white",
                  color: filterStatus === "leaver" ? "white" : "#64748b",
                  fontSize: "12px",
                  fontWeight: "600",
                  cursor: "pointer",
                }}
              >
                Leaver's Work
              </button>
            </div>
          </div>
          <div
            style={{
              background: "white",
              borderRadius: "16px",
              boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.05)",
              border: "1px solid #f1f5f9",
              overflow: "hidden",
            }}
          >
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                <thead>
                  <tr style={{ textAlign: "left", background: "#f8fafc", borderBottom: "2px solid #e2e8f0" }}>
                    <th style={{ padding: "14px 16px", color: "#64748b", fontWeight: "700", fontSize: "11px", textTransform: "uppercase" }}>
                      Claim
                    </th>
                    <th style={{ padding: "14px 16px", color: "#64748b", fontWeight: "700", fontSize: "11px", textTransform: "uppercase" }}>
                      Type
                    </th>
                    <th style={{ padding: "14px 16px", color: "#64748b", fontWeight: "700", fontSize: "11px", textTransform: "uppercase" }}>
                      Status
                    </th>
                    <th style={{ padding: "14px 16px", color: "#64748b", fontWeight: "700", fontSize: "11px", textTransform: "uppercase" }}>
                      Confidence
                    </th>
                    <th style={{ padding: "14px 16px", color: "#64748b", fontWeight: "700", fontSize: "11px", textTransform: "uppercase" }}>
                      Author
                    </th>
                    <th style={{ padding: "14px 16px", color: "#64748b", fontWeight: "700", fontSize: "11px", textTransform: "uppercase" }}>
                      Source &amp; Proof
                    </th>
                    <th style={{ padding: "14px 16px", color: "#64748b", fontWeight: "700", fontSize: "11px", textTransform: "uppercase" }}>
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredClaims.slice(0, showAll ? undefined : 25).map((claim) => (
                    <tr key={claim.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "14px 16px", color: "#334155", fontWeight: "600" }}>
                        {claim.text}
                      </td>
                      <td style={{ padding: "14px 16px", color: "#334155" }}>
                        <span
                          style={{
                            display: "inline-block",
                            padding: "4px 8px",
                            borderRadius: "6px",
                            background: `${typeColor(claim.type)}15`,
                            color: typeColor(claim.type),
                            fontSize: "11px",
                            fontWeight: "600",
                          }}
                        >
                          {claim.type.replace(/_/g, " ").toUpperCase()}
                        </span>
                      </td>
                      <td style={{ padding: "14px 16px", color: "#334155" }}>
                        <span
                          style={{
                            display: "inline-block",
                            padding: "4px 8px",
                            borderRadius: "6px",
                            background: `${statusColor(claim.status)}15`,
                            color: statusColor(claim.status),
                            fontSize: "11px",
                            fontWeight: "600",
                          }}
                        >
                          {claim.status.toUpperCase()}
                        </span>
                      </td>
                      <td style={{ padding: "14px 16px", color: "#334155" }}>
                        {(claim.confidence * 100).toFixed(0)}%
                      </td>
                      <td style={{ padding: "14px 16px", color: "#64748b" }}>
                        {claim.author || "Unknown"}
                        {claim.isLeaver && (
                          <span
                            style={{
                              display: "inline-block",
                              marginLeft: "6px",
                              padding: "2px 6px",
                              borderRadius: "4px",
                              background: "#ec4899",
                              color: "white",
                              fontSize: "10px",
                              fontWeight: "700",
                            }}
                          >
                            LEAVER
                          </span>
                        )}
                      </td>
                      <td style={{ padding: "14px 16px", color: "#334155" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <a
                            href={claim.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "4px",
                              color: "#3b82f6",
                              textDecoration: "none",
                              fontSize: "12px",
                              fontWeight: "600",
                            }}
                          >
                            <span style={{ fontSize: "10px" }}>🔗</span> Source
                          </a>
                          {claim.proof && (
                            <span
                              style={{
                                fontSize: "10px",
                                color: "#64748b",
                                background: "#f8fafc",
                                padding: "2px 6px",
                                borderRadius: "4px",
                              }}
                            >
                              {claim.proof.type?.replace(/_/g, " ").toUpperCase()}
                            </span>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: "14px 16px", color: "#334155" }}>
                        <button
                          onClick={() => {
                            const newStatus = claim.status === "accepted" ? "proposed" : "accepted";
                            fetch(`/api/claims/${claim.id}`, {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ status: newStatus }),
                            });
                            setClaims(claims.map((c) => (c.id === claim.id ? { ...c, status: newStatus } : c)));
                          }}
                          style={{
                            padding: "6px 14px",
                            background: claim.status === "accepted" ? "#64748b" : "#3b82f6",
                            color: "white",
                            border: "none",
                            borderRadius: "6px",
                            fontSize: "12px",
                            fontWeight: "600",
                            cursor: "pointer",
                          }}
                        >
                          {claim.status === "accepted" ? "Reopen" : "Accept"}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filteredClaims.length > 25 && !showAll && (
                    <tr>
                      <td colSpan={7} style={{ padding: "16px", textAlign: "center" }}>
                        <button
                          onClick={() => setShowAll(true)}
                          style={{
                            padding: "8px 20px",
                            background: "#f8fafc",
                            color: "#3b82f6",
                            border: "1px solid #cbd5e1",
                            borderRadius: "8px",
                            fontSize: "13px",
                            fontWeight: "600",
                            cursor: "pointer",
                          }}
                        >
                          Show all {filteredClaims.length} claims
                        </button>
                      </td>
                    </tr>
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