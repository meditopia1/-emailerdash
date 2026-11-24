import { NextResponse } from "next/server";
import { z } from "zod";
import { campaignApiGuard } from "../../../../../lib/campaign-api";
import { audienceError, customDefinitions, inputError } from "../../../../../lib/audience-server";
import { mappedImportRow, importTargets } from "../../../../../lib/contact-import";
import { supabaseAdmin } from "../../../../../lib/supabase-admin";
const jobColumns = "id,file_name,fingerprint,total_rows,status,mode,mapping,tags,list_id,staged_count,processed_count,imported_count,updated_count,skipped_count,invalid_count,duplicate_count,failed_count,last_error,created_at,updated_at";
export async function GET(request: Request) {
  const denied = await campaignApiGuard(request); if (denied) return denied;
  try { const { data, error } = await supabaseAdmin().from("mail_contact_imports").select(jobColumns).order("created_at", { ascending: false }).limit(30); if (error) throw error; return NextResponse.json({ jobs: data }, { headers: { "Cache-Control": "no-store" } }); } catch (error) { return audienceError(error); }
}
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview"), mapping: z.record(z.string(), z.string()), rows: z.array(z.array(z.string().max(10000)).max(100)).max(100) }).strict(),
  z.object({ action: z.literal("create"), id: z.string().uuid(), file_name: z.string().min(1).max(200), fingerprint: z.string().regex(/^[a-f0-9]{64}$/), total_rows: z.number().int().min(1).max(100000), mapping: z.record(z.string().regex(/^\d{1,3}$/), z.string().max(100)).refine(value => Object.keys(value).length <= 100), mode: z.enum(["skip", "update"]), tags: z.array(z.string().trim().min(1).max(50)).max(20), list_id: z.string().uuid().nullable() }).strict(),
  z.object({ action: z.literal("stage"), id: z.string().uuid(), rows: z.array(z.object({ row_number: z.number().int().min(1).max(100000), values: z.array(z.string().max(10000)).max(100) }).strict()).min(1).max(200) }).strict(),
  z.object({ action: z.enum(["start", "cancel", "resume", "process"]), id: z.string().uuid() }).strict(),
]);
export async function POST(request: Request) {
  const denied = await campaignApiGuard(request); if (denied) return denied;
  try {
    const body = schema.parse(await request.json()); const db = supabaseAdmin({ writeTimeoutMs: 25000 });
    if (body.action === "preview") {
      const fields = await customDefinitions(); const seen = new Set<string>();
      const rows = body.rows.map((row, index) => {
        try { const mapped = mappedImportRow(row, body.mapping, fields); const email = mapped.complete.email; const duplicate = seen.has(email); seen.add(email); return { row: index + 2, email, status: duplicate ? "duplicate" : "valid", error: "" }; }
        catch (error) { return { row: index + 2, email: "", status: "invalid", error: error instanceof z.ZodError ? error.issues[0].message : error instanceof Error ? error.message : "Invalid row" }; }
      });
      const emails = rows.filter(row => row.status === "valid").map(row => row.email);
      if (emails.length) { const existing = await db.from("mail_contacts").select("normalized_email").in("normalized_email", emails).limit(100); if (existing.error) throw existing.error; const saved = new Set(existing.data.map(row => row.normalized_email)); for (const row of rows) if (row.status === "valid" && saved.has(row.email)) row.status = "existing"; }
      return NextResponse.json({ rows });
    }
    if (body.action === "create") {
      const fields = await customDefinitions(); const targets = Object.values(body.mapping).filter(Boolean);
      if (!targets.includes("email") || new Set(targets).size !== targets.length || targets.some(target => !importTargets.includes(target) && !fields.some(field => field.id === target))) inputError("Map exactly one column to email and use each target field only once.");
      const { action: _action, ...job } = body;
      const { error } = await db.from("mail_contact_imports").upsert(job, { onConflict: "id", ignoreDuplicates: true }); if (error) throw error;
      const existing = await db.from("mail_contact_imports").select(jobColumns).eq("id", body.id).single(); if (existing.error) throw existing.error;
      if (existing.data.fingerprint !== body.fingerprint || JSON.stringify(existing.data.mapping) !== JSON.stringify(body.mapping)) inputError("This upload ID belongs to a different file or mapping. Start a new import.");
      return NextResponse.json({ job: existing.data }, { status: 201 });
    }
    const current = await db.from("mail_contact_imports").select(jobColumns).eq("id", body.id).single(); if (current.error) throw current.error;
    const job = current.data;
    if (body.action === "stage") {
      const fields = await customDefinitions();
      const batch = body.rows.map(row => {
        try {
          const mapped = mappedImportRow(row.values, job.mapping, fields);
          // Defaults are needed only for new records. Mark mapped keys for safe existing updates.
          return { row_number: row.row_number, data: { ...mapped.complete, _supplied: mapped.supplied }, error: null };
        } catch (error) { const emailColumn = Object.keys(job.mapping).find(key => job.mapping[key] === "email"); return { row_number: row.row_number, data: { email: emailColumn ? row.values[Number(emailColumn)]?.trim().toLowerCase() ?? "" : "" }, error: error instanceof z.ZodError ? error.issues.map(item => item.message).slice(0, 3).join("; ") : error instanceof Error ? error.message : "Invalid row" }; }
      });
      const result = await db.rpc("mail_import_stage", { target: body.id, batch }); if (result.error) throw result.error;
      return NextResponse.json({ staged_count: result.data });
    }
    if (body.action === "process") {
      // Explicit bounded fallback. Normal processing uses the persistent worker, not this HTTP request.
      const result = await db.rpc("mail_process_import_batch", { target: body.id, batch_size: 100 }); if (result.error) throw result.error;
    } else {
      if (body.action === "start" && (job.status !== "uploading" || job.staged_count !== job.total_rows)) inputError("Finish uploading every row before starting the import.");
      if (body.action === "resume" && !["queued", "running", "failed"].includes(job.status)) inputError("This import does not need resuming.");
      const status = body.action === "cancel" ? "cancelled" : "queued";
      const result = await db.from("mail_contact_imports").update({ status, attempts: 0, last_error: null, updated_at: new Date().toISOString() }).eq("id", body.id).eq("status", job.status).neq("status", "completed").select("id").maybeSingle(); if (result.error) throw result.error; if (!result.data) inputError("This import changed in another session. Refresh its progress before trying again.");
    }
    return NextResponse.json({ id: body.id });
  } catch (error) { return audienceError(error, true); }
}
