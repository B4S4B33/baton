"use client";

import { useEffect, useState } from "react";

export default function Home() {
  const [claims, setClaims] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [debug, setDebug] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("http://localhost:3000/api/claims")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`);
        return r.json();
      })
      .then((data) => {
        if (!cancelled) {
          setClaims(data.claims || []);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e.message);
          setDebug(e.toString());
          setLoading(false);
          console.error("Fetch error:", e);
        }
      });
    return () => { cancelled = true; };
  }, []);

  const updateClaim = async (id: string, status: string) => {
    await fetch(`http://localhost:3000/api/claims/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setClaims(claims.map((c) => (c.id === id ? { ...c, status } : c)));
  };

  if (loading) return <div style={{ padding: "20px", fontFamily: "system-ui" }}>Loading claims...</div>;
  if (error) return (
    <div style={{ padding: "20px", fontFamily: "system-ui" }}>
      <h2 style={{ color: "red" }}>Error: {error}</h2>
      <pre style={{ background: "#f5f5f5", padding: "10px", borderRadius: "4px", fontSize: "12px" }}>{debug}</pre>
      <button onClick={() => window.location.reload()} style={{ marginTop: "10px", padding: "8px 16px" }}>Retry</button>
    </div>
  );

  return (
    <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "20px", fontFamily: "system-ui" }}>
      <h1 style={{ fontSize: "24px", fontWeight: "bold", marginBottom: "20px" }}>Knowledge Handover — Claim Review</h1>
      <p style={{ marginBottom: "20px", color: "#666" }}>{claims.length} claims found from ingested sources</p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(350px, 1fr))", gap: "16px" }}>
        {claims.map((c) => (
          <div key={c.id} style={{ border: "1px solid #ddd", borderRadius: "8px", padding: "16px", background: "#fff" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "10px" }}>
              <span style={{
                fontSize: "12px",
                fontWeight: "600",
                padding: "4px 8px",
                borderRadius: "4px",
                background: c.type === "decision" ? "#e3f2fd" : "#e8f5e9",
                color: c.type === "decision" ? "#1565c0" : "#2e7d32"
              }}>{c.type}</span>
              <span style={{ fontSize: "12px", color: "#999" }}>{c.confidence}</span>
            </div>
            <h3 style={{ fontSize: "16px", fontWeight: "600", marginBottom: "8px", display: "-webkit-box", WebkitLineClamp: "2", WebkitBoxOrient: "vertical", overflow: "hidden" }}>{c.text}</h3>
            <p style={{ fontSize: "12px", color: "#666", marginBottom: "8px" }}>Source: {c.sourceType}</p>
            <a
              href={c.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: "12px", color: "#1565c0", textDecoration: "none", marginBottom: "10px", display: "block" }}
            >
              Open in GitHub →
            </a>
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                onClick={() => updateClaim(c.id, "accepted")}
                style={{ flex: 1, padding: "8px", background: "#4caf50", color: "white", border: "none", borderRadius: "4px", cursor: "pointer", fontSize: "12px" }}
              >
                Accept
              </button>
              <button
                onClick={() => updateClaim(c.id, "rejected")}
                style={{ flex: 1, padding: "8px", background: "#f44336", color: "white", border: "none", borderRadius: "4px", cursor: "pointer", fontSize: "12px" }}
              >
                Reject
              </button>
            </div>
            <p style={{ fontSize: "11px", color: "#999", marginTop: "10px" }}>Status: {c.status}</p>
          </div>
        ))}
      </div>
    </div>
  );
}