import { NextRequest, NextResponse } from "next/server";
import { campaignApiGuard } from "../../../../lib/campaign-api";
import { campaignCapabilities } from "../../../../lib/campaign-capabilities";
import { deriveSetup, type SetupEvidence } from "../../../../lib/guided-setup";
import { apiCredential, integrationSettings, webhookCredential } from "../../../../lib/resend-integration";
import { environmentCredentialCurrent } from "../../../../lib/resend-provider";
import { supabaseAdmin } from "../../../../lib/supabase-admin";

type Facts = {
  domains: { id: string; domain: string; verification_status: string; verification_source: string; verified_credential_version: string | null; open_tracking: boolean | null; click_tracking: boolean | null }[];
  identities: { domain_id: string; from_email: string; sender_name: string; company_name: string; physical_address: string; is_default: boolean; tested_credential_version: string | null; last_test_at: string | null }[];
  contacts: { total: number; eligible: number };
  draft: NonNullable<SetupEvidence["facts"]>["draft"]; submitted: boolean; prepared_campaign: boolean; configuration_truncated: boolean;
};

export async function GET(request: NextRequest) {
  const denied = await campaignApiGuard(request); if (denied) return denied;
  const evidence: SetupEvidence = { connection: null, facts: null };
  const [configuration, records] = await Promise.allSettled([
    integrationSettings(),
    Promise.resolve().then(() => supabaseAdmin().rpc("mail_guided_setup_facts", undefined, { get: true })),
  ]);
  let current = false; let version: string | undefined;
  if (configuration.status === "fulfilled") {
    try {
      const settings = configuration.value; const key = apiCredential(settings);
      current = Boolean(key && (settings?.resend_api_key_ciphertext || environmentCredentialCurrent(settings?.environment_credential_fingerprint, key).current));
      version = settings?.credential_version;
      evidence.connection = { configured: Boolean(key), validated: Boolean(key && current && settings?.connection_state === "connection_validated" && settings.last_validated_at), failed: Boolean(current && ["validation_failed", "needs_attention"].includes(settings?.connection_state ?? "")), webhookConfigured: Boolean(webhookCredential(settings)), webhookReceived: Boolean(settings?.last_webhook_at) };
    } catch { /* Unreadable credentials are unknown, not disconnected. Never return secrets. */ }
  }
  if (records.status === "fulfilled" && !records.value.error && records.value.data) {
    const facts = records.value.data as Facts;
    evidence.facts = {
      contacts: facts.contacts, draft: facts.draft, submitted: facts.submitted, prepared_campaign: facts.prepared_campaign, configuration_truncated: facts.configuration_truncated,
      domains: facts.domains.map(domain => ({ id: domain.id, domain: domain.domain, verified: Boolean(current && version && domain.verified_credential_version === version && domain.verification_source === "provider" && domain.verification_status === "verified"), manual: domain.verification_source === "manual", tracking: domain.open_tracking === true && domain.click_tracking === true, failed: ["failed", "temporary_failure", "failure"].includes(domain.verification_status) })),
      identities: facts.identities.map(sender => ({ domain_id: sender.domain_id, from_email: sender.from_email, is_default: sender.is_default, valid: Boolean(sender.sender_name.trim() && sender.company_name.trim() && sender.physical_address.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sender.from_email)), tested: Boolean(current && evidence.connection?.validated && version && sender.tested_credential_version === version && sender.last_test_at) })),
    };
  }
  const snapshot = deriveSetup(evidence, campaignCapabilities);
  if (snapshot.verification !== "verified") console.warn(JSON.stringify({ scope: "guided_setup", verification: snapshot.verification }));
  // A successful status read can explicitly contain unknown checks. Never collapse them to zeros.
  return NextResponse.json(snapshot, { headers: { "Cache-Control": "private, no-store" } });
}
