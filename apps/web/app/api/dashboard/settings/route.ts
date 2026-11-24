import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "../../../../lib/supabase-admin";
import { auditIntegration, identitySchema, integrationFailure, integrationGuard, integrationSettings, settingsColumns } from "../../../../lib/resend-integration";
import { IntegrationError } from "../../../../lib/resend-provider";
import { senderAddressIssue } from "../../../../lib/email-setup-validation";

export async function GET(request: Request) {
  const denied = await integrationGuard(request); if (denied) return denied;
  const { data, error } = await supabaseAdmin().from("mail_settings").select(settingsColumns).eq("id", true).maybeSingle();
  if (error) return NextResponse.json({ error: "Could not load settings" }, { status: 500 });
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: Request) {
  const denied = await integrationGuard(request); if (denied) return denied;
  try {
    const body = identitySchema.extend({ id: z.string().uuid().optional() }).strict().parse(await request.json());
    const db = supabaseAdmin(); await integrationSettings(true);
    const { data: domain, error } = await db.from("mail_sending_domains").select("id,domain").eq("id", body.domain_id).maybeSingle();
    if (error) throw new IntegrationError("We could not check your sending domain. Your entries have been kept; wait a moment and try Save sender identity again.", 503);
    if (!domain) throw new IntegrationError("Choose a domain from Sending domain. If your domain is missing, link it in Sending domains above, then return to this form.", 400, "domain_id");
    const addressIssue = senderAddressIssue(body.from_email, domain.domain);
    if (addressIssue) throw new IntegrationError(addressIssue, 400, "from_email");
    const { id, ...fields } = body;
    if (!id) {
      const { count } = await db.from("mail_sender_identities").select("id", { count: "exact", head: true });
      if (count === null || count >= 100) throw new IntegrationError("Up to 100 local sender identities are supported.");
    }
    const values = { ...fields, reply_to: fields.reply_to || null, tested_credential_version: null, last_test_at: null };
    const query = id ? db.from("mail_sender_identities").update(values).eq("id", id) : db.from("mail_sender_identities").insert(values);
    const { data: sender, error: saveError } = await query.select("id,is_default").maybeSingle();
    if (saveError?.code === "23505") throw new IntegrationError("This From address already has a sender identity. Find it in the list below and choose Edit identity instead of adding it again.", 409, "from_email");
    if (saveError || !sender) throw new IntegrationError("We could not save this sender. Your entries have been kept. Refresh Email Setup and check the identities below before trying again.", 503);
    await auditIntegration(id ? "sender_updated" : "sender_created", sender.id);
    return NextResponse.json({ id: sender.id, message: "Sender saved. Next: choose Make default sender below if this is your usual identity, then Send test email in Tracking & testing. Existing campaigns are unchanged." });
  } catch (error) { return integrationFailure(error); }
}
