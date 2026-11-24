import { NextResponse } from "next/server";
import { z } from "zod";
import { decryptSecret } from "./crypto";
import { campaignApiGuard } from "./campaign-api";
import { environmentCredentialCurrent, IntegrationError, ResendProvider, type ProviderDomain } from "./resend-provider";
import { supabaseAdmin } from "./supabase-admin";
export { domainName, emailAddress, identitySchema } from "./email-setup-validation";

export const settingsColumns = "id,sender_name,from_email,reply_to,company_name,physical_address,verified_domain,updated_at";
export const domainColumns = "id,domain,provider_domain_id,verification_status,verification_source,verified_credential_version,last_checked_at,is_default,dns_records,open_tracking,click_tracking";
export const identityColumns = "id,domain_id,sender_name,from_email,reply_to,company_name,physical_address,is_default,tested_credential_version,last_test_at";
const privateColumns = `${settingsColumns},resend_api_key_ciphertext,webhook_secret_ciphertext,connection_state,credential_version,environment_credential_fingerprint,connection_disabled,managed_domains,last_validated_at,last_test_at,last_connection_error,last_webhook_at`;

export async function integrationGuard(request: Request, bucket = "configuration", max = 20) {
  const denied = await campaignApiGuard(request); if (denied) return denied;
  if (request.method !== "GET") {
    const { data, error } = await supabaseAdmin().rpc("mail_integration_rate_limit", { target_bucket: bucket, max_attempts: max, window_seconds: 60 });
    if (error) return NextResponse.json({ error: "Email setup cannot reach configuration storage right now. Your entries are kept. Wait a moment and retry; if it continues, ask your administrator to check the Supabase connection and integration migrations." }, { status: 503 });
    if (!data) return NextResponse.json({ error: "Too many integration requests. Wait one minute." }, { status: 429, headers: { "Retry-After": "60" } });
  }
  return null;
}
export function integrationFailure(error: unknown) {
  if (error instanceof IntegrationError) return NextResponse.json({ error: error.message, ...(error.field ? { field_errors: { [error.field]: error.message } } : {}) }, { status: error.status });
  if (error instanceof z.ZodError) {
    const fields: Record<string, string> = {};
    for (const issue of error.issues) if (typeof issue.path[0] === "string" && !fields[issue.path[0]]) fields[issue.path[0]] = issue.message;
    return NextResponse.json({ error: error.issues[0]?.message ?? "Review the highlighted fields, then save again. Your entries have been kept.", field_errors: fields }, { status: 400 });
  }
  return NextResponse.json({ error: "We could not finish this step. Your entries are still here. Refresh Email Setup to check whether the change was saved before trying again; if it keeps failing, ask your administrator to check the server configuration." }, { status: 500 });
}
export function encryptionKey() { const key = process.env.ENCRYPTION_MASTER_KEY; if (!key) throw new IntegrationError("Configure the server encryption master key before storing credentials.", 503); return key; }
export async function integrationSettings(ensure = false) {
  const db = supabaseAdmin();
  if (ensure) { const { error } = await db.from("mail_settings").upsert({ id: true }, { onConflict: "id", ignoreDuplicates: true }); if (error) throw new IntegrationError("Integration storage unavailable. Apply migration 0006.", 503); }
  const { data, error } = await db.from("mail_settings").select(privateColumns).eq("id", true).maybeSingle();
  if (error) {
    console.error(JSON.stringify({ scope: "integration_read", operation: "settings", code: error.code || null }));
    throw new IntegrationError(["42P01", "42703"].includes(error.code) ? "Email configuration schema is incomplete. Ask your administrator to check the applied integration migrations." : "Email configuration storage could not be reached. Try Refresh again; if this continues, ask your administrator to check the Supabase connection.", 503);
  }
  if (ensure && data && !data.connection_disabled && !data.resend_api_key_ciphertext && process.env.RESEND_API_KEY) {
    const evidence = environmentCredentialCurrent(data.environment_credential_fingerprint, process.env.RESEND_API_KEY);
    if (!evidence.current) {
      const { error: syncError } = await db.rpc("sync_mail_environment_credential", { fingerprint: evidence.fingerprint });
      if (syncError) throw new IntegrationError("Cannot synchronize rotated environment credentials.", 503);
      const updated = await db.from("mail_settings").select(privateColumns).eq("id", true).single();
      if (updated.error) throw new IntegrationError("Cannot reload credential evidence.", 503);
      return updated.data;
    }
  }
  return data;
}
export type IntegrationSettings = NonNullable<Awaited<ReturnType<typeof integrationSettings>>>;
export function apiCredential(settings: IntegrationSettings | null) {
  if (settings?.connection_disabled) return null;
  if (settings?.resend_api_key_ciphertext) return decryptSecret(settings.resend_api_key_ciphertext, encryptionKey());
  return process.env.RESEND_API_KEY || null;
}
export function webhookCredential(settings: IntegrationSettings | null) {
  if (settings?.webhook_secret_ciphertext) return decryptSecret(settings.webhook_secret_ciphertext, encryptionKey());
  return process.env.RESEND_WEBHOOK_SIGNING_SECRET || null;
}
export function integrationProvider(settings: IntegrationSettings, management = false) {
  const key = apiCredential(settings); if (!key) throw new IntegrationError("Add an active key in Resend connection above and click Connect Resend. If you disconnected earlier, reconnect before loading domains or sending a test.");
  if (management && !settings.managed_domains) throw new IntegrationError("To load or manage domains here, save a Full Access key, tick Enable managed domain setup, then click Save management preference. With Sending Access, verify the domain in Resend and choose the manual connection method instead.", 403);
  return new ResendProvider(key);
}
export async function integrationAction(operation: string, details: Record<string, unknown>) {
  const { error } = await supabaseAdmin().rpc("mail_integration_action", { operation, details });
  if (error) throw new IntegrationError("Could not save integration changes.", 500);
}
export async function auditIntegration(action: string, entity_id?: string, outcome = "success") {
  const { error } = await supabaseAdmin().from("mail_integration_audit").insert({ action, entity_id, outcome });
  if (error) throw new IntegrationError("Could not persist integration audit.", 500);
}
export function domainEvidence(value: ProviderDomain, credential_version: string) {
  return { provider_domain_id: value.id, verification_status: value.status, verification_source: "provider", verified_credential_version: credential_version, last_checked_at: new Date().toISOString(), dns_records: value.records ?? [], open_tracking: value.open_tracking ?? null, click_tracking: value.click_tracking ?? null };
}
export async function integrationSnapshot() {
  const db = supabaseAdmin(); const settings = await integrationSettings();
  const [domains, identities, tests, audit] = await Promise.all([
    db.from("mail_sending_domains").select(domainColumns).order("created_at", { ascending: true }).limit(100),
    db.from("mail_sender_identities").select(identityColumns).order("created_at", { ascending: true }).limit(100),
    db.from("mail_test_sends").select("id,from_email,destination,status,provider_message_id,error_message,last_event_type,last_event_at,created_at").order("created_at", { ascending: false }).limit(10),
    db.from("mail_integration_audit").select("id,action,outcome,created_at").order("created_at", { ascending: false }).limit(10),
  ]);
  if (domains.error || identities.error || tests.error || audit.error) throw new IntegrationError("Integration records unavailable. Apply migration 0006.", 503);
  const key = apiCredential(settings); const configured = Boolean(key); const version = settings?.credential_version;
  const evidenceCurrent = Boolean(settings?.resend_api_key_ciphertext || (key && environmentCredentialCurrent(settings?.environment_credential_fingerprint, key).current));
  const senders = (identities.data ?? []).map(identity => {
    const domain = domains.data?.find(row => row.id === identity.domain_id);
    const tested = Boolean(evidenceCurrent && settings?.connection_state === "connection_validated" && version && identity.tested_credential_version === version && identity.last_test_at);
    const verified = Boolean(version && domain?.verified_credential_version === version && domain?.verification_status === "verified");
    const { tested_credential_version: _, ...safe } = identity;
    return { ...safe, sending_validated: configured && tested, production_eligible: configured && tested && Boolean(domain) && (verified || domain?.verification_source === "manual") };
  });
  return { connection: { configured, state: configured ? evidenceCurrent ? settings?.connection_state ?? "configuration_saved" : "configuration_saved" : "not_configured", credential_source: !configured ? null : settings?.resend_api_key_ciphertext ? "encrypted_database" : "server_environment", masked_key: configured ? "•••••••• (stored securely)" : null, managed_domains: Boolean(settings?.managed_domains), last_validated_at: evidenceCurrent ? settings?.last_validated_at ?? null : null, last_test_at: settings?.last_test_at ?? null, error: evidenceCurrent ? settings?.last_connection_error ?? null : null },
    domains: (domains.data ?? []).map(({ verified_credential_version, ...domain }) => ({ ...domain, evidence_current: Boolean(evidenceCurrent && configured && version && verified_credential_version === version) })),
    identities: senders, tests: tests.data ?? [], audit: audit.data ?? [],
    webhook: { endpoint: `${(process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3001").replace(/\/$/, "")}/api/webhooks/resend/default`, secret_configured: Boolean(webhookCredential(settings)), last_verified_event_at: settings?.last_webhook_at ?? null, health: settings?.last_webhook_at ? "verified_event_received" : "awaiting_verified_event" },
  };
}

/** Draft snapshots may retain a legacy sender. No draft operation grants permission to send. */
export async function resolveDraftSender(db: ReturnType<typeof supabaseAdmin>, from: string | undefined, previous?: string) {
  const { data: settings, error } = await db.from("mail_settings").select("sender_name,from_email,reply_to").eq("id", true).maybeSingle();
  if (error || !settings) throw new IntegrationError("Save Email Setup first.");
  const email = from || settings.from_email;
  if (email === previous || email === settings.from_email) return { ...settings, from_email: email };
  const { data: sender, error: senderError } = await db.from("mail_sender_identities").select("sender_name,from_email,reply_to").eq("from_email", email).maybeSingle();
  if (senderError || !sender) throw new IntegrationError("Use a configured sender identity from Email Setup.");
  return sender;
}
