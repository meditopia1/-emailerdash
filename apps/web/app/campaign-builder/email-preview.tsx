"use client";
import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import type { Audience, Draft } from "./model";

export function EmailPreview({ draft, audience, onClose }: { draft: Draft; audience: Audience; onClose: () => void }) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const recipient = audience.rows.find(row => row.eligible) ?? { name: "Alex", email: "preview@example.com" };
  const personalize = (value: string, html = false) => value.replace(/\{\{\s*(name|email|custom\.[a-z][a-z0-9_]{0,49})\s*\}\}/g, (_, key: string) => { const custom = "custom_fields" in recipient ? recipient.custom_fields?.[key.slice(7)] : null; const result = key === "name" ? recipient.name || recipient.email : key === "email" ? recipient.email : custom == null ? "" : Array.isArray(custom) ? custom.join(", ") : String(custom); return html ? result.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!)) : result; });
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null; closeButton.current?.focus();
    const keydown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", keydown); return () => { document.removeEventListener("keydown", keydown); previous?.focus(); };
  }, [onClose]);
  const html = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none'"><style>body{font:14px/1.8 Arial,sans-serif;padding:20px;color:#202525;background:white;overflow-wrap:anywhere}img{max-width:100%}</style></head><body>${personalize(draft.content_html, true)}</body></html>`;
  return <div className="modal-backdrop" onClick={onClose}><section className="os-dialog builder-preview-dialog" role="dialog" aria-modal="true" aria-label="Email preview" onClick={event => event.stopPropagation()}><div className="section-heading"><h2>Email preview</h2><button ref={closeButton} className="icon-button-os" aria-label="Close preview" onClick={onClose}><X size={20} /></button></div><div className="preview-email-from">{draft.sender_name || "Your sender"}<small>{draft.from_email || "Set up your sender address"}</small><small>To: {recipient.email}{audience.rows.length ? " · selected contact" : " · preview example only"}</small></div><h3>{personalize(draft.subject || "Your subject line")}</h3>{draft.preheader && <p className="muted-os">{personalize(draft.preheader)}</p>}{draft.content_format === "html" ? <iframe title="Personalized HTML email" sandbox="" referrerPolicy="no-referrer" srcDoc={html} className="email-preview-frame" /> : <p className="email-preview-content">{personalize(draft.content_text || "Your email content will appear here.")}</p>}<p className="tracking-note">Preview only. Scripts, external images, and tracking requests are disabled.</p><button className="os-button secondary" onClick={onClose}>Back to editing</button></section></div>;
}
