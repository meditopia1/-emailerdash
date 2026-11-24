import { NextResponse } from "next/server";
import { z } from "zod";
import { encryptSecret } from "../../../../../lib/crypto";
import { supabaseAdmin } from "../../../../../lib/supabase-admin";
import { domainName, domainEvidence, encryptionKey, integrationAction, integrationFailure, integrationGuard, integrationProvider, integrationSettings, integrationSnapshot, auditIntegration } from "../../../../../lib/resend-integration";
import { IntegrationError } from "../../../../../lib/resend-provider";
import { domainNextStep } from "../../../../../lib/email-setup-validation";

const confirmed = z.literal(true, { errorMap: () => ({ message: "Confirm this change before continuing." }) });
const id = z.string().uuid();
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("connect"), api_key: z.string().trim().min(10).max(500).regex(/^re_[A-Za-z0-9_-]+$/, "Enter a Resend API key."), managed: z.boolean(), confirmed }).strict(),
  z.object({ action: z.literal("disconnect"), confirmed }).strict(),
  z.object({ action: z.literal("management"), enabled: z.boolean(), confirmed }).strict(),
  z.object({ action: z.literal("webhook_secret"), secret: z.string().trim().regex(/^whsec_[A-Za-z0-9+/=_-]{16,500}$/, "Enter the webhook signing secret from Resend."), confirmed }).strict(),
  z.object({ action: z.literal("list_provider_domains"), after: z.string().max(200).optional() }).strict(),
  z.object({ action: z.literal("add_domain"), domain: domainName, method: z.enum(["manual", "link", "create"]), provider_id: z.string().min(1).max(200).optional(), confirmed }).strict(),
  z.object({ action: z.literal("refresh_domain"), id }).strict(), z.object({ action: z.literal("verify_domain"), id, confirmed }).strict(),
  z.object({ action: z.literal("tracking"), id, open_tracking: z.boolean(), click_tracking: z.boolean(), confirmed }).strict(),
  z.object({ action: z.literal("remove_domain"), id, confirmed }).strict(), z.object({ action: z.literal("default_domain"), id, confirmed }).strict(),
  z.object({ action: z.literal("default_sender"), id, confirmed }).strict(),
]);

export async function GET(request: Request) {
  const denied = await integrationGuard(request); if (denied) return denied;
  try { return NextResponse.json(await integrationSnapshot(), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return integrationFailure(error); }
}

export async function POST(request: Request) {
  const denied = await integrationGuard(request); if (denied) return denied;
  try {
    const body = actionSchema.parse(await request.json()); const db = supabaseAdmin();
    if (body.action === "connect") {
      await integrationAction("connect", { ciphertext: encryptSecret(body.api_key, encryptionKey()), managed: body.managed });
      return NextResponse.json({ message: "API key saved securely; no email was sent. Next: link your sending domain, add a matching sender identity, then explicitly send a test to validate sending access." });
    }
    if (body.action === "disconnect") { await integrationAction("disconnect", {}); return NextResponse.json({ message: "Disconnected. Environment-key fallback is disabled. Historical records are unchanged." }); }
    if (body.action === "management") { await integrationAction("management", { enabled: body.enabled }); return NextResponse.json({ message: "Management preference saved for the existing key. If you pasted a new key, click Replace API key to save it, then Load provider domains. This checkbox does not grant Full Access; the key must already have that permission in Resend." }); }
    if (body.action === "webhook_secret") { await integrationAction("webhook_secret", { ciphertext: encryptSecret(body.secret, encryptionKey()) }); return NextResponse.json({ message: "Signing secret saved. Waiting for an actual verified event." }); }
    const settings = await integrationSettings(true); if (!settings) throw new IntegrationError("Settings unavailable.", 503);
    if (body.action === "list_provider_domains") {
      const result = await integrationProvider(settings, true).listDomains(body.after);
      await auditIntegration("provider_domains_listed");
      const message = result.data.length ? `Found ${result.data.length} domain${result.data.length === 1 ? "" : "s"} in Resend. Choose one in Provider domain, then click Link domain.` : body.after ? "No more domains were returned. Choose a domain already loaded, then click Link domain." : "Resend returned no domains for the saved API key. Check that Resend Domains and your API key belong to the same team. If you pasted a different key above, click Replace API key first, then Load provider domains again.";
      return NextResponse.json({ provider_domains: result.data.map(({ id, name, status }) => ({ id, name, status })), has_more: result.has_more ?? false, message });
    }
    if (body.action === "add_domain") {
      const { count } = await db.from("mail_sending_domains").select("id", { count: "exact", head: true });
      if (count === null || count >= 100) throw new IntegrationError("Up to 100 local domains are supported.");
      const { data: existing } = await db.from("mail_sending_domains").select("id").eq("domain", body.domain).maybeSingle();
      if (existing && body.method !== "link") throw new IntegrationError("Domain already configured. Use Refresh status or link its existing provider record.", 409);
      let evidence: Record<string, unknown> = {};
      if (body.method !== "manual") {
        const provider = integrationProvider(settings, true);
        if (body.method === "link" && !body.provider_id) throw new IntegrationError("Click Load provider domains, choose your domain in Provider domain, then click Link domain.", 400, "domain");
        const domain = body.method === "create" ? await provider.createDomain(body.domain) : await provider.getDomain(body.provider_id!);
        if (domain.name.toLowerCase() !== body.domain) throw new IntegrationError(`The selected Resend domain is ${domain.name}. Choose that entry again so Sending domain matches, then click Link domain.`, 400, "domain");
        evidence = domainEvidence(domain, settings.credential_version);
      }
      const query = existing ? db.from("mail_sending_domains").update(evidence).eq("id", existing.id) : db.from("mail_sending_domains").insert({ domain: body.domain, ...evidence });
      const { data, error } = await query.select("id").single();
      if (error) throw new IntegrationError("Could not save the domain reference. If Resend created it, link it from the existing-domain list; do not create it again.", 409);
      await auditIntegration("domain_added", data.id);
      return NextResponse.json({ message: body.method === "manual" ? `${body.domain} linked as self-reported; DNS verification has not been checked here. Next: choose it in Your sending identity, add a matching From address, save it, then explicitly send a test. A successful test confirms sending access, not DNS verification.` : domainNextStep(String(evidence.verification_status), body.domain) });
    }
    if (body.action === "default_domain" || body.action === "remove_domain" || body.action === "default_sender") {
      await integrationAction(body.action, { id: body.id });
      return NextResponse.json({ message: body.action === "remove_domain" ? "Local reference removed. No Resend domain or DNS record was deleted." : "Default updated for future configuration. Existing campaign snapshots are unchanged." });
    }
    const { data: domain, error } = await db.from("mail_sending_domains").select("id,domain,provider_domain_id").eq("id", body.id).maybeSingle();
    if (error || !domain) throw new IntegrationError("This domain reference is no longer available. Refresh Email Setup, then choose a linked domain or import it again from Resend.", 404);
    const provider = integrationProvider(settings, true);
    if (!domain.provider_domain_id) throw new IntegrationError("This manual domain has no provider ID. Import it from the connected account, or manage verification in Resend.");
    let result;
    if (body.action === "verify_domain") { await provider.verifyDomain(domain.provider_domain_id); result = await provider.getDomain(domain.provider_domain_id); }
    else if (body.action === "tracking") result = await provider.updateTracking(domain.provider_domain_id, body.open_tracking, body.click_tracking);
    else result = await provider.getDomain(domain.provider_domain_id);
    if (result.name.toLowerCase() !== domain.domain) throw new IntegrationError("The linked Resend record belongs to a different domain. Choose Import domain from connected Resend account, load the provider domains and link the matching entry before using this sender.");
    const { error: saveError } = await db.from("mail_sending_domains").update(domainEvidence(result, settings.credential_version)).eq("id", domain.id);
    if (saveError) throw new IntegrationError("Provider responded, but local evidence could not be saved. Refresh status.", 500);
    await auditIntegration(body.action, domain.id);
    return NextResponse.json({ message: body.action === "tracking" ? "Tracking settings refreshed from Resend. Check Opens and Clicks below for the provider-confirmed values. Opens remain approximate; delivery events require signed webhooks." : domainNextStep(result.status, domain.domain) });
  } catch (error) { return integrationFailure(error); }
}
