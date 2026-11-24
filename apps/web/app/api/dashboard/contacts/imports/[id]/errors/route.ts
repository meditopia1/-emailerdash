import { NextResponse } from "next/server";
import { z } from "zod";
import { campaignApiGuard } from "../../../../../../../lib/campaign-api";
import { audienceError } from "../../../../../../../lib/audience-server";
import { supabaseAdmin } from "../../../../../../../lib/supabase-admin";
import { csvCell } from "../../../../../../../lib/contact-import";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await campaignApiGuard(request); if (denied) return denied;
  try {
    const id = z.string().uuid().parse((await context.params).id); const page = z.coerce.number().int().min(0).max(1000).parse(new URL(request.url).searchParams.get("page") ?? 0);
    const result = await supabaseAdmin().from("mail_contact_import_rows").select("row_number,normalized_email,status,error").eq("job_id", id).in("status", ["invalid", "duplicate", "failed"]).order("row_number").range(page * 1000, page * 1000 + 999); if (result.error) throw result.error;
    const csv = ["row,email,status,error", ...result.data.map(row => [row.row_number + 1, row.normalized_email, row.status, row.error ?? "Duplicate within this file; first occurrence wins"].map(csvCell).join(","))].join("\r\n");
    return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename=import-errors-page-${page + 1}.csv`, "Cache-Control": "no-store" } });
  } catch (error) { return audienceError(error); }
}
