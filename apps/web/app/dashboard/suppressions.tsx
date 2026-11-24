"use client";
import { useEffect, useState } from "react";
import { EmptyState } from "./forms";
import { requestJson, statusLabel, type Section } from "./types";

type Row = { id: string; normalized_email: string; reason: string; source: string; created_at: string };
export function Suppressions({ query, navigate }: { query: string; navigate: (section: Section) => void }) {
  const [rows, setRows] = useState<Row[]>([]); const [cursor, setCursor] = useState<string | null>(null);
  const [next, setNext] = useState<string | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [revision, setRevision] = useState(0);
  useEffect(() => { setRows([]); setCursor(null); setNext(null); }, [query]);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true);
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ q: query }); if (cursor) params.set("cursor", cursor);
      requestJson<{ rows: Row[]; next_cursor: string | null }>(`/api/dashboard/suppressions?${params}`, { signal: controller.signal }).then(result => {
        if (controller.signal.aborted) return;
        setRows(current => cursor ? [...new Map([...current, ...result.rows].map(row => [row.id, row])).values()] : result.rows); setNext(result.next_cursor); setError("");
      }).catch(failure => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Could not load suppressions."); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, cursor, revision]);
  return <section className="os-panel"><div className="section-heading"><div><span className="eyebrow">SENDING SAFEGUARDS</span><h2>Suppressed addresses</h2><p>These addresses are blocked from sending. This list is read-only.</p></div><button className="text-button-os" onClick={() => navigate("Contacts")}>View contacts</button></div>
    {error && <p className="form-message" role="alert">{error}</p>}
    {loading && !rows.length ? <div className="integration-skeleton" role="status" aria-label="Loading suppressions"><div /><span>Loading suppressed addresses…</span></div> : rows.length ? <div className="os-table-scroll"><table className="os-table"><thead><tr><th>Email address</th><th>Reason</th><th>Source</th><th>Suppressed on</th></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td>{row.normalized_email}</td><td>{statusLabel(row.reason)}</td><td>{statusLabel(row.source)}</td><td>{new Date(row.created_at).toLocaleString()}</td></tr>)}</tbody></table></div> : !error && <EmptyState icon="activity" title={query ? "No matching suppressed addresses." : "No suppressed addresses."} text={query ? "Try another email address." : "Addresses blocked by recorded suppression rules will appear here."} />}
    <div className="integration-actions"><button className="os-button secondary" disabled={loading} onClick={() => { setCursor(null); setRevision(value => value + 1); }}>Refresh suppressions</button>{next && <button className="os-button secondary" disabled={loading} onClick={() => setCursor(next)}>{loading ? "Loading…" : "Load more addresses"}</button>}</div>
  </section>;
}
