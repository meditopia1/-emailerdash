"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { Send, X, ShieldCheck } from "lucide-react";
import { Field } from "./forms";
import { requestJson } from "./types";
import type { EmailIntegration } from "./email-integration-types";
import { invalidateSetup } from "../help/events";

export function TestEmailDialog({ integration, initialFrom, content, onClose, onSent }: { integration: EmailIntegration; initialFrom?: string; content?: { subject: string; text?: string; html?: string }; onClose: () => void; onSent: () => Promise<void> }) {
  const [sender, setSender] = useState(() => integration.identities.find(row => row.from_email === initialFrom)?.id ?? integration.identities.find(row => row.is_default)?.id ?? "");
  const [destination, setDestination] = useState(""); const [confirmed, setConfirmed] = useState(false); const [authorized, setAuthorized] = useState(false);
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(""); const [finished, setFinished] = useState(false);
  const requestId = useRef(crypto.randomUUID()); const dialog = useRef<HTMLDivElement>(null);
  const identity = integration.identities.find(row => row.id === sender);
  const from = sender === "test" ? "Marketing OS Test <onboarding@resend.dev>" : identity ? `${identity.sender_name} <${identity.from_email}>` : "Choose an identity";
  const close = useRef(onClose); close.current = onClose; const busyRef = useRef(busy); busyRef.current = busy;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLElement>("button, input, select")?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) close.current();
      if (event.key !== "Tab") return;
      const nodes = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href]') ?? []);
      const first = nodes[0]; const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", key); return () => { document.removeEventListener("keydown", key); previous?.focus(); };
  }, []);
  async function send(event: FormEvent) {
    event.preventDefault(); if (busy || finished) return; setBusy(true); setMessage("");
    try {
      const result = await requestJson<{ message: string; provider_message_id: string }>("/api/dashboard/settings/resend/test", { method: "POST", body: JSON.stringify({ request_id: requestId.current, ...(sender === "test" ? { use_resend_test_sender: true } : { sender_id: sender }), destination, confirmed, authorized_mailbox: authorized, ...(content ? { subject: content.subject || "Campaign preview", text: content.text, html: content.html } : {}) }) });
      setMessage(`${result.message} Provider ID: ${result.provider_message_id}`); setFinished(true); invalidateSetup();
      try { await onSent(); } catch { setMessage(current => `${current} Status refresh failed; refresh Email Setup to view the recorded result.`); }
    } catch (error) { setFinished(true); setMessage(`${error instanceof Error ? error.message : "Test failed."} Close this dialog and check the recorded result before starting a new test.`); }
    finally { setBusy(false); }
  }
  return createPortal(<div className="modal-backdrop"><div className="os-dialog integration-test-dialog" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="test-email-heading"><div className="section-heading"><div><span className="eyebrow">ONE EMAIL. EXPLICITLY REQUESTED.</span><h2 id="test-email-heading">Send test email</h2></div><button type="button" className="icon-button-os" aria-label="Close test dialog" onClick={onClose} disabled={busy}><X size={19} /></button></div><form className="os-form-grid" onSubmit={send}><Field label="Test sender" full><select value={sender} required onChange={event => { setSender(event.target.value); setConfirmed(false); }} disabled={busy || finished}><option value="">Choose a configured identity</option>{integration.identities.map(row => <option key={row.id} value={row.id}>{row.sender_name} · {row.from_email}</option>)}<option value="test">Explicit Resend test sender · onboarding@resend.dev</option></select></Field><Field label="Test destination" full><input type="email" required maxLength={320} autoComplete="email" value={destination} disabled={busy || finished} onChange={event => { setDestination(event.target.value); setConfirmed(false); }} placeholder="A mailbox you control" /></Field><div className="integration-info full"><ShieldCheck size={19} /><p>This action sends one real test, even when campaign dry-run is enabled. No audience is queued. Resend&apos;s test domain only supports permitted test recipients. Suppressed destinations remain blocked.</p></div><div className="test-confirmation full"><strong>{from}</strong><span>→ {destination || "Choose a destination"}</span><small>Subject: [TEST] {content?.subject || "Marketing OS connection check"}</small></div><label className="consent-check full"><input type="checkbox" required checked={authorized} disabled={busy || finished} onChange={event => setAuthorized(event.target.checked)} />I control or am authorized to use this destination mailbox.</label><label className="consent-check full"><input type="checkbox" required checked={confirmed} disabled={busy || finished} onChange={event => setConfirmed(event.target.checked)} />I confirm this sender and destination. Send one test email.</label>{message && <p role="status" className="form-message full">{message}</p>}<div className="form-footer full"><span>Accepted is not delivered.</span><button className="os-button" disabled={busy || finished || !sender || !confirmed || !authorized || !integration.connection.configured}><Send size={16} />{busy ? "Sending one test…" : finished ? "Test finished" : "Confirm & send test"}</button></div></form></div></div>, document.body);
}
