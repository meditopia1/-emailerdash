import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { emailAddress, integrationFailure, integrationGuard, integrationProvider, integrationSettings } from "../../../../../../lib/resend-integration";
import { IntegrationError } from "../../../../../../lib/resend-provider";
import { supabaseAdmin } from "../../../../../../lib/supabase-admin";

const testSchema = z.object({ request_id: z.string().uuid(), sender_id: z.string().uuid().optional(), destination: emailAddress, use_resend_test_sender: z.boolean().default(false), confirmed: z.literal(true), authorized_mailbox: z.literal(true), subject: z.string().trim().min(1).max(900).default("Marketing OS connection check"), text: z.string().max(100000).optional(), html: z.string().max(100000).optional() }).strict();

export async function POST(request: Request) {
  const denied = await integrationGuard(request, "test_email", 5); if (denied) return denied;
  try {
    const body = testSchema.parse(await request.json());
    const settings = await integrationSettings(true); if (!settings) throw new IntegrationError("Settings unavailable.", 503);
    const provider = integrationProvider(settings); const db = supabaseAdmin();
    const { data: suppressed, error: suppressionError } = await db.from("mail_suppressions").select("id").eq("normalized_email", body.destination).maybeSingle();
    if (suppressionError) throw new IntegrationError("Cannot verify destination suppression status.", 503);
    if (suppressed) throw new IntegrationError("Destination is suppressed. Tests cannot bypass suppression.");
    let sender: { id?: string; from_email: string; sender_name: string; reply_to: string | null };
    if (body.use_resend_test_sender) {
      if (body.sender_id) throw new IntegrationError("Choose a configured identity or the explicit Resend test sender, not both.");
      sender = { from_email: "onboarding@resend.dev", sender_name: "Marketing OS Test", reply_to: null };
    } else {
      if (!body.sender_id) throw new IntegrationError("Select a configured sender identity.");
      const { data, error } = await db.from("mail_sender_identities").select("id,domain_id,from_email,sender_name,reply_to").eq("id", body.sender_id).maybeSingle();
      if (error || !data) throw new IntegrationError("Sender identity not found.", 404);
      const { data: domain } = await db.from("mail_sending_domains").select("domain").eq("id", data.domain_id).maybeSingle();
      if (!domain || data.from_email.split("@")[1] !== domain.domain || domain.domain === "resend.dev") throw new IntegrationError("Sender/domain mismatch. Correct Email Setup first.");
      sender = data;
    }
    const input = { from: `${sender.sender_name} <${sender.from_email}>`, to: body.destination, ...(sender.reply_to ? { reply_to: sender.reply_to } : {}), subject: body.subject, ...(body.html ? { html: body.html } : { text: body.text || "This is an explicitly requested Marketing OS test. Provider acceptance does not confirm inbox delivery." }) };
    const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const { error: insertError } = await db.from("mail_test_sends").insert({ id: body.request_id, sender_identity_id: sender.id ?? null, credential_version: settings.credential_version, from_email: sender.from_email, destination: body.destination, content_hash: hash });
    if (insertError) {
      const { data: existing } = await db.from("mail_test_sends").select("status,provider_message_id,content_hash").eq("id", body.request_id).maybeSingle();
      if (existing?.content_hash === hash && existing.status === "accepted") return NextResponse.json({ accepted: true, provider_message_id: existing.provider_message_id, message: "This test was already accepted by Resend. No second email was sent." });
      throw new IntegrationError("This test is already pending or finished. Check its recorded outcome before explicitly starting a new test.", 409);
    }
    try {
      const result = await provider.sendTest(input, body.request_id);
      const { error } = await db.rpc("finish_mail_test", { test_id: body.request_id, result_status: "accepted", provider_id: result.id, safe_error: null });
      if (error) return NextResponse.json({ error: "Resend accepted the test, but result persistence failed. Do not resend. Check Resend logs.", provider_message_id: result.id }, { status: 503 });
      return NextResponse.json({ accepted: true, provider_message_id: result.id, message: "Accepted by Resend. Inbox delivery is not confirmed; wait for a signed delivery event." });
    } catch (error) {
      const safe = error instanceof IntegrationError ? error : new IntegrationError("Unexpected provider response. Check Resend logs before sending another test.", 503);
      await db.rpc("finish_mail_test", { test_id: body.request_id, result_status: safe.status >= 500 ? "unknown" : "failed", provider_id: null, safe_error: safe.message });
      throw safe;
    }
  } catch (error) { return integrationFailure(error); }
}
