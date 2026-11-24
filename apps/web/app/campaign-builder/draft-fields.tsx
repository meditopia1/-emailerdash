"use client";

import { useRef } from "react";
import { Eye, Info, Send } from "lucide-react";
import { Field } from "../dashboard/forms";
import type { SenderSettings } from "../dashboard/types";
import type { Draft } from "./model";

export type DraftFieldProps = { draft: Draft; onChange: (patch: Partial<Draft>) => void; readOnly: boolean; errors?: Record<string, string> };

export function StartFields({ draft, onChange, readOnly, errors = {} }: DraftFieldProps) {
  return <fieldset className="builder-fieldset" disabled={readOnly}>
    <Field label="Campaign name" error={errors.name}><input name="name" required maxLength={200} value={draft.name} onChange={event => onChange({ name: event.target.value })} placeholder="e.g. Monthly product update" /></Field>
    <p className="builder-help">An internal name to keep your campaigns organized. Your recipients won&apos;t see it.</p>
  </fieldset>;
}

export function EmailFields({ draft, onChange, readOnly, onPreview, onSender, onTest, senderSettings, errors = {} }: DraftFieldProps & { onPreview: () => void; onSender: () => void; onTest: () => void; senderSettings: SenderSettings | null }) {
  const editor = useRef<HTMLTextAreaElement>(null);
  const content = draft.content_format === "html" ? draft.content_html : draft.content_text;
  const contentKey = draft.content_format === "html" ? "content_html" : "content_text";
  function personalize(token: string) {
    const start = editor.current?.selectionStart ?? content.length; const end = editor.current?.selectionEnd ?? start;
    onChange({ [contentKey]: content.slice(0, start) + token + content.slice(end) });
    requestAnimationFrame(() => { editor.current?.focus(); editor.current?.setSelectionRange(start + token.length, start + token.length); });
  }
  return <>
    {Boolean(senderSettings?.identities?.length) && <Field label="Sender identity"><select value={senderSettings?.identities?.some(row => row.from_email === draft.from_email) ? draft.from_email : ""} disabled={readOnly} onChange={event => { const sender = senderSettings?.identities?.find(row => row.from_email === event.target.value); if (sender) onChange({ from_email: sender.from_email, sender_name: sender.sender_name, reply_to: sender.reply_to ?? "" }); }}><option value="">Keep campaign sender snapshot</option>{senderSettings?.identities?.map(sender => <option key={sender.id} value={sender.from_email}>{sender.sender_name} · {sender.from_email}{sender.is_default ? " · default" : ""}</option>)}</select></Field>}
    <fieldset className="builder-fieldset" disabled={readOnly}>
      <div className="builder-fields-pair"><Field label="Sender display name" error={errors.sender_name}><input name="sender_name" required maxLength={200} value={draft.sender_name} onChange={event => onChange({ sender_name: event.target.value })} placeholder="Your company" /></Field><Field label="From address" error={errors.from_email}><input name="from_email" type="email" readOnly value={draft.from_email} placeholder="Configure Email Setup" /></Field></div>
      <button type="button" className="builder-text-button" onClick={onSender}>Edit configured sender in Email Setup</button>
      {senderSettings && draft.from_email !== senderSettings.from_email && <button type="button" className="builder-text-button" onClick={() => onChange({ from_email: senderSettings.from_email, sender_name: senderSettings.sender_name, reply_to: senderSettings.reply_to ?? "" })}>Use current configured sender: {senderSettings.from_email}</button>}
      <Field label="Reply-to address" error={errors.reply_to}><input name="reply_to" type="email" value={draft.reply_to} onChange={event => onChange({ reply_to: event.target.value })} placeholder="hello@yourcompany.com" /></Field>
      <Field label="Subject line" error={errors.subject}><input name="subject" required maxLength={998} value={draft.subject} onChange={event => onChange({ subject: event.target.value })} placeholder="Something they'll want to open" /></Field>
      <Field label="Preview text"><input name="preheader" maxLength={500} value={draft.preheader} onChange={event => onChange({ preheader: event.target.value })} placeholder="Optional preheader" /></Field>
      <div className="builder-field-label">Content format<div className="builder-segment small" role="group" aria-label="Email content format"><button type="button" aria-pressed={draft.content_format === "text"} onClick={() => onChange({ content_format: "text" })}>Plain text</button><button type="button" aria-pressed={draft.content_format === "html"} onClick={() => onChange({ content_format: "html" })}>HTML</button></div></div>
      <Field label="Email content" field="content" error={errors.content}><textarea ref={editor} name="content" required className="builder-email-editor" value={content} onChange={event => onChange({ [contentKey]: event.target.value })} placeholder={draft.content_format === "html" ? "<p>Hello {{name}},</p>" : "Hello {{name}},\n\nStart your story here..."} /></Field>
      <div className="personalization-actions"><span>Personalize</span>{["{{name}}", "{{email}}"].map(token => <button type="button" key={token} onClick={() => personalize(token)}>{token}</button>)}</div>
      <div className="builder-fields-pair"><Field label="Delay between recipients"><input name="send_delay_ms" type="number" min={0} max={600000} step={1000} value={draft.send_delay_ms} onChange={event => onChange({ send_delay_ms: Math.max(0, Math.min(600000, Number(event.target.value) || 0)) })} /><p className="builder-help">Milliseconds between each recipient. 0 uses normal worker speed.</p></Field><div className="builder-help"><strong>Send pacing</strong><br />Applies only to this campaign.</div></div>
    </fieldset>
    <div className="builder-inline-actions"><button type="button" className="builder-button secondary" onClick={onPreview}><Eye size={15} />Preview email</button><button type="button" className="builder-button secondary" disabled={readOnly || !draft.from_email} onClick={onTest}><Send size={14} />Send test email</button></div>
    <p className="builder-help"><Info size={13} />Tests send one explicitly confirmed email, never the selected audience. Sender validation is enforced by Resend; campaign launch uses a durable queue with pre-send checks and worker retries.</p>
  </>;
}
