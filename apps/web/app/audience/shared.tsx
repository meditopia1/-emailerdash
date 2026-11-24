"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { requestJson } from "../dashboard/types";
export const audienceEndpoint = "/api/dashboard/contacts";
export const dateLabel = (value?: string | null) => value ? new Date(value).toLocaleString() : "—";
export function Drawer({ title, children, onClose, wide = false, eyebrow = "AUDIENCE MANAGEMENT" }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean; eyebrow?: string }) {
  const element = useRef<HTMLElement>(null); const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null; const bodyOverflow = document.body.style.overflow; document.body.style.overflow = "hidden";
    element.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") close.current();
      if (event.key === "Tab") {
        const focusable = [...(element.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]') ?? [])].filter(node => node.getClientRects().length);
        if (!focusable.length) { event.preventDefault(); return; }
        const first = focusable[0], last = focusable.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === element.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === element.current)) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener("keydown", key); return () => { document.removeEventListener("keydown", key); document.body.style.overflow = bodyOverflow; previous?.focus(); };
  }, []);
  return <div className="audience-overlay" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section className={`audience-drawer${wide ? " wide" : ""}`} ref={element} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}><header><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div><button type="button" className="icon-button-os" aria-label={`Close ${title}`} onClick={onClose}><X size={21} /></button></header>{children}</section></div>;
}
export function AudienceSkeleton() { return <div className="audience-skeleton" role="status" aria-label="Loading contacts">{Array.from({ length: 5 }, (_, index) => <div key={index} className="skeleton-row" />)}<span className="sr-only">Loading audience records…</span></div>; }
export async function downloadCsv(path: string, body?: unknown) {
  const response = await fetch(path, { method: body ? "POST" : "GET", headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined, cache: "no-store", signal: AbortSignal.timeout(30000) });
  if (response.status === 401) { window.location.assign("/login"); throw new Error("Sign in again to export contacts."); }
  if (!response.ok) { const detail = await response.json().catch(() => ({})); throw new Error(detail.error || "Export could not be prepared. Try again."); }
  const link = document.createElement("a"); const url = URL.createObjectURL(await response.blob()); link.href = url; link.download = response.headers.get("content-disposition")?.match(/filename=([^;]+)/)?.[1] ?? "contacts.csv"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const api = requestJson;
