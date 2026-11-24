import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "./supabase-admin";
import { filterSchema, type AudienceResources, type CustomField } from "./audience-schema";

export function audienceError(error: unknown, write = false) {
  const issue = error as { code?: string; message?: string };
  if (error instanceof z.ZodError) {
    const field_errors = Object.fromEntries(error.issues.map(item => [item.path.join("."), item.message]));
    return NextResponse.json({ error: error.issues[0]?.message ?? "Review the supplied fields.", field_errors }, { status: 400 });
  }
  if (error instanceof SyntaxError) return NextResponse.json({ error: "Use valid JSON and filter parameters." }, { status: 400 });
  if (issue.code === "23505") return NextResponse.json({ error: "That email or name already exists. Open the existing record instead of adding it again.", field_errors: { email: "This email already exists. Find and edit its contact profile." } }, { status: 409 });
  if (["22023", "22007", "22008", "22P02", "23514", "23503", "P0002"].includes(issue.code ?? "")) return NextResponse.json({ error: issue.code === "22023" ? issue.message : "A referenced record or field value is invalid. Refresh the form and review the highlighted values." }, { status: 400 });
  console.error(JSON.stringify({ scope: "audience", code: issue.code ?? null, error: error instanceof Error ? error.name : "StorageError" }));
  return NextResponse.json({ error: write ? "Storage did not confirm this change. Refresh the saved records before trying again; no automatic retry was made." : "Audience storage could not be reached. Previously loaded records may be outdated. Try Refresh again." }, { status: 503 });
}
const criteriaSchema = z.object({ page: z.coerce.number().int().min(0).max(10000).default(0), page_size: z.coerce.number().int().min(1).max(100).default(25), search: z.string().trim().max(200).default(""), sort: z.enum(["name", "email", "company", "lifecycle_status", "consent_status", "imported_at", "last_contacted_at", "last_opened_at", "last_clicked_at", "campaign_count"]).default("imported_at"), direction: z.enum(["asc", "desc"]).default("desc"), filter: filterSchema.optional(), segment_id: z.string().uuid().optional(), list_id: z.string().uuid().optional(), include_archived: z.boolean().optional() }).strict();
export function audienceCriteria(params: URLSearchParams) {
  const raw = params.get("filter"); if (raw && raw.length > 15000) throw new z.ZodError([{ code: "custom", path: ["filter"], message: "Use a smaller filter definition." }]);
  return criteriaSchema.parse({ page: params.get("page") ?? undefined, page_size: params.get("page_size") ?? undefined, search: params.get("search") ?? "", sort: params.get("sort") ?? undefined, direction: params.get("direction") ?? undefined, filter: raw ? JSON.parse(raw) : undefined, segment_id: params.get("segment_id") || undefined, list_id: params.get("list_id") || undefined, include_archived: params.get("include_archived") === "true" });
}
export async function audienceResources(): Promise<AudienceResources> {
  const { data, error } = await supabaseAdmin().rpc("mail_audience_metadata", undefined, { get: true }); if (error) throw error;
  return data.resources;
}
export async function customDefinitions(): Promise<CustomField[]> {
  const { data, error } = await supabaseAdmin().from("mail_contact_fields").select("id,name,key,type,options").order("created_at").limit(50); if (error) throw error; return data ?? [];
}
export function inputError(message: string): never { throw Object.assign(new Error(message), { code: "22023" }); }
