import { NextResponse } from "next/server";
import { z } from "zod";
import { campaignApiGuard } from "../../../../../lib/campaign-api";
import { audienceError, audienceResources, inputError } from "../../../../../lib/audience-server";
import { resourceSchema } from "../../../../../lib/audience-schema";
import { supabaseAdmin } from "../../../../../lib/supabase-admin";
export async function GET(request: Request) {
  const denied = await campaignApiGuard(request); if (denied) return denied;
  try { return NextResponse.json(await audienceResources(), { headers: { "Cache-Control": "no-store" } }); } catch (error) { return audienceError(error); }
}
export async function POST(request: Request) {
  const denied = await campaignApiGuard(request); if (denied) return denied;
  try {
    const body = resourceSchema.parse(await request.json());
    if (body.kind === "segment" && !body.filter) inputError("Define the segment's filter conditions.");
    if (body.kind === "field" && (!body.type || !body.key || (["single_select", "multi_select"].includes(body.type) && !body.options.length))) inputError("Choose a field type, personalization key, and select options where required.");
    const { data, error } = await supabaseAdmin({ writeTimeoutMs: 25000 }).rpc("mail_audience_resource_save", { payload: body }); if (error) throw error;
    return NextResponse.json({ id: data }, { status: 201 });
  } catch (error) { return audienceError(error, true); }
}
export async function DELETE(request: Request) {
  const denied = await campaignApiGuard(request); if (denied) return denied;
  try {
    const body = z.object({ kind: z.enum(["segment", "list", "field"]), id: z.string().uuid() }).strict().parse(await request.json());
    const db = supabaseAdmin({ writeTimeoutMs: 25000 });
    if (body.kind === "field") { const { count, error } = await db.from("mail_contact_field_values").select("contact_id", { count: "exact", head: true }).eq("field_id", body.id); if (error) throw error; if (count) inputError("This field contains contact data. Keep it to preserve those values."); }
    const table = { segment: "mail_audience_segments", list: "mail_contact_lists", field: "mail_contact_fields" }[body.kind];
    const { error } = await db.from(table).delete().eq("id", body.id); if (error) throw error;
    return NextResponse.json({ removed: true });
  } catch (error) { return audienceError(error, true); }
}
