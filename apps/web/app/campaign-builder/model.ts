import type { Campaign, SenderSettings } from "../dashboard/types";
import type { AudienceSelection } from "../../lib/audience-schema";

export type StepId = "start" | "audience" | "email" | "results";
export const steps: StepId[] = ["start", "audience", "email", "results"];
export const stepLabels: Record<StepId, string> = { start: "Campaign Start", audience: "Audience", email: "Email", results: "Results" };
export type Position = { x: number; y: number };
export type WorkflowLayout = { version: 1; positions: Record<StepId, Position>; viewport: { x: number; y: number; zoom: number }; selectedNode: StepId };
export const defaultPositions: Record<StepId, Position> = { start: { x: 60, y: 60 }, audience: { x: 390, y: 60 }, email: { x: 390, y: 360 }, results: { x: 60, y: 360 } };
export const defaultLayout: WorkflowLayout = { version: 1, positions: defaultPositions, viewport: { x: 25, y: 140, zoom: .65 }, selectedNode: "start" };
export type Draft = { name: string; subject: string; preheader: string; content_text: string; content_html: string; content_format: "text" | "html"; sender_name: string; from_email: string; reply_to: string; audience_contact_ids: string[]; audience_selection?: AudienceSelection; send_delay_ms: number };
export type BuilderCampaign = Campaign & { sender_name: string; from_email: string; reply_to: string | null; subject: string; preheader: string | null; content_text: string | null; content_html: string | null; audience_contact_ids: string[]; audience_selection?: AudienceSelection; send_delay_ms: number; revision: number; workflow_layout: Partial<WorkflowLayout>; layout_revision: number; started_at?: string | null; completed_at?: string | null };
export type AudienceContact = { id: string; email: string; name: string | null; consent_source: string | null; consented_at: string | null; eligible: boolean; reason: string | null; custom_fields?: Record<string, unknown> };
export type Audience = { rows: AudienceContact[]; selected: number; eligible: number; excluded: number; missing: number; not_found?: string[]; fingerprint?: string };
export const emptyAudience: Audience = { rows: [], selected: 0, eligible: 0, excluded: 0, missing: 0 };
export type AudienceApproval = { id: string; eligible_count: number; approved_at: string; fingerprint: string };
export type CampaignDetail = { campaign: BuilderCampaign; audience: Audience; capabilities: { send: boolean; testSend: boolean; reason: string }; audience_approval?: AudienceApproval | null };
export function newDraft(settings: SenderSettings | null): Draft { return { name: "", subject: "", preheader: "", content_text: "", content_html: "", content_format: "text", sender_name: settings?.sender_name ?? "", from_email: settings?.from_email ?? "", reply_to: settings?.reply_to ?? "", audience_contact_ids: [], audience_selection: { type: "contacts" }, send_delay_ms: 0 }; }
export function campaignDraft(campaign: BuilderCampaign): Draft { return { name: campaign.name, subject: campaign.subject, preheader: campaign.preheader ?? "", content_text: campaign.content_text ?? "", content_html: campaign.content_html ?? "", content_format: campaign.content_html !== null ? "html" : "text", sender_name: campaign.sender_name, from_email: campaign.from_email, reply_to: campaign.reply_to ?? "", audience_contact_ids: campaign.audience_contact_ids ?? [], audience_selection: campaign.audience_selection ?? { type: "contacts" }, send_delay_ms: campaign.send_delay_ms ?? 0 }; }
export function draftIssues(draft: Draft) {
  return draftIssueDetails(draft).map(issue => issue.message);
}

export function draftIssueDetails(draft: Draft) {
  const issues: { field: string; message: string; step: StepId }[] = [];
  if (!draft.name.trim()) issues.push({ field: "name", message: "Add a campaign name.", step: "start" });
  if (!draft.subject.trim()) issues.push({ field: "subject", message: "Add an email subject.", step: "email" });
  if (!(draft.content_format === "html" ? draft.content_html : draft.content_text).trim()) issues.push({ field: "content", message: "Write your email content.", step: "email" });
  if (!draft.sender_name.trim() || !draft.from_email.trim()) issues.push({ field: draft.sender_name.trim() ? "from_email" : "sender_name", message: "Configure your sender in Email Setup.", step: "email" });
  return issues;
}

/** RFC-style quoted CSV fields; limits keep browser work bounded. Imported addresses do not grant consent. */
export function parseAudienceCsv(source: string) {
  if (source.length > 1000000) throw new Error("Choose a CSV smaller than 1 MB.");
  const rows: string[][] = []; let row: string[] = []; let field = ""; let quoted = false;
  const input = source.replace(/^\uFEFF/, "");
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (char === '"') { if (quoted && input[index + 1] === '"') { field += '"'; index++; } else if (quoted || field === "") quoted = !quoted; else throw new Error("Unexpected quote in CSV."); }
    else if (char === "," && !quoted) { row.push(field); field = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) { if (char === "\r" && input[index + 1] === "\n") index++; row.push(field); if (row.some(value => value.trim())) rows.push(row); row = []; field = ""; if (rows.length > 1001) throw new Error("Import up to 1,000 recipients at a time."); }
    else field += char;
  }
  if (quoted) throw new Error("A quoted CSV field was not closed.");
  row.push(field); if (row.some(value => value.trim())) rows.push(row);
  if (rows.length > 1001) throw new Error("Import up to 1,000 recipients at a time.");
  const emailColumn = rows[0]?.findIndex(value => value.trim().toLowerCase() === "email") ?? -1;
  if (emailColumn < 0) throw new Error("CSV must include an email column.");
  const emails = new Set<string>(); const invalid: number[] = []; let duplicates = 0;
  rows.slice(1).forEach((values, index) => { const email = (values[emailColumn] ?? "").trim().toLowerCase(); if (!/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(email) || email.length > 320) invalid.push(index + 2); else if (emails.has(email)) duplicates++; else emails.add(email); });
  return { emails: [...emails], invalid, duplicates, total: rows.length - 1 };
}
