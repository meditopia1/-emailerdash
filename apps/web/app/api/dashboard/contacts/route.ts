import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "../../../../lib/supabase-admin";
import { normalizeEmail } from "@marketing-os/email";
import { campaignApiGuard } from "../../../../lib/campaign-api";
import { resolveCampaignAudience } from "../../../../lib/campaign-audience";
import { audienceCriteria, audienceError, customDefinitions } from "../../../../lib/audience-server";
import { contactCreateInputSchema, validateCustomValues } from "../../../../lib/audience-schema";

export async function GET(request: NextRequest) {
  const denied = await campaignApiGuard(request); if (denied) return denied;
  try {
    const criteria = audienceCriteria(request.nextUrl.searchParams); const db = supabaseAdmin();
    const [page, metadata] = await Promise.all([
      db.rpc("mail_audience_query", { criteria: JSON.stringify(criteria) }, { get: true }),
      request.nextUrl.searchParams.get("metadata") === "false" ? Promise.resolve({ data: {}, error: null }) : db.rpc("mail_audience_metadata", undefined, { get: true }),
    ]);
    if (page.error || metadata.error) throw page.error ?? metadata.error;
    return NextResponse.json({ ...page.data, ...metadata.data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return audienceError(error); }
}
export async function POST(request: NextRequest) {
  const denied = await campaignApiGuard(request); if (denied) return denied;
  try {
    const body = await request.json();
    if (body.action === "resolve") {
      const selection = z.object({ action: z.literal("resolve"), contact_ids: z.array(z.string().uuid()).max(1000).optional().default([]), emails: z.array(z.string().max(320)).max(1000).optional().default([]) }).strict().parse(body);
      const db = supabaseAdmin({ writeTimeoutMs: 25000 }); const ids = new Set(selection.contact_ids); const notFound: string[] = [];
      const emails = [...new Set(selection.emails.map(normalizeEmail))];
      for (let index = 0; index < emails.length; index += 100) {
        const batch = emails.slice(index, index + 100); const { data, error } = await db.from("mail_contacts").select("id,normalized_email").in("normalized_email", batch).limit(100);
        if (error) throw error; const found = new Set((data ?? []).map(row => row.normalized_email));
        for (const row of data ?? []) ids.add(row.id); notFound.push(...batch.filter(email => !found.has(email)));
      }
      if (ids.size > 1000) return NextResponse.json({ error: "Select at most 1,000 contacts" }, { status: 400 });
      return NextResponse.json({ ...await resolveCampaignAudience(db, [...ids]), not_found: notFound });
    }
    const { existing_opt_in, ...parsed } = contactCreateInputSchema.parse(body);
    if (Object.keys(parsed.custom_fields).length > 0) validateCustomValues(parsed.custom_fields, await customDefinitions());
    const { data, error } = await supabaseAdmin({ writeTimeoutMs: 25000 }).rpc(existing_opt_in ? "mail_contact_add_opted_in" : "mail_contact_save", { payload: parsed }); if (error) throw error;
    return NextResponse.json({ id: data }, { status: 201 });
  } catch (error) { return audienceError(error, true); }
}
