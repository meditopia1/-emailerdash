import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabase-admin";
import { campaignApiGuard } from "../../../../lib/campaign-api";
import { apiCredential, integrationSettings } from "../../../../lib/resend-integration";
import { environmentCredentialCurrent } from "../../../../lib/resend-provider";
import { storedClickUrl } from "../../../../lib/dashboard-read-model";

type Identity = { id: string; sender_name: string; from_email: string; reply_to: string | null; is_default: boolean; tested_credential_version: number | null; last_test_at: string | null };
type Snapshot = { campaigns: Record<string, unknown>[]; contacts: Record<string, unknown>[]; identities: Identity[]; events: Array<Record<string, unknown> & { payload: unknown; event_type: string }>; totals: Record<string, number> };
export async function GET(request: Request) {
  const denied = await campaignApiGuard(request); if (denied) return denied;
  try {
    const [read, settings] = await Promise.all([
      supabaseAdmin().rpc("mail_dashboard_snapshot", { sending_only: new URL(request.url).searchParams.get("view") === "sending" }, { get: true }),
      integrationSettings(),
    ]);
    if (read.error) throw read.error;
    const snapshot = read.data as Snapshot;
    let key: string | null = null; let credentialError = false;
    try { key = apiCredential(settings); } catch { credentialError = true; }
    const identity = snapshot.identities.find(row => row.is_default) ?? snapshot.identities.find(row => row.from_email === settings?.from_email) ?? snapshot.identities[0];
    const current = Boolean(settings?.resend_api_key_ciphertext || (key && environmentCredentialCurrent(settings?.environment_credential_fingerprint, key).current));
    const tested = Boolean(key && current && settings?.connection_state === "connection_validated" && identity?.last_test_at && identity.tested_credential_version === settings?.credential_version);
    const status = credentialError ? "Credential storage unavailable · review Email Setup" : !key ? "Resend not configured" : !identity ? "API key saved · add a sender identity" : !identity.is_default ? "Sender saved · choose a default" : tested ? "Sending access validated" : "Sender saved · test required";
    // Explicit allow-list: credential material and validation versions never reach the browser.
    const safeSettings = settings ? { sender_name: identity?.sender_name || settings.sender_name, from_email: identity?.from_email || settings.from_email, reply_to: identity?.reply_to ?? settings.reply_to, company_name: settings.company_name, physical_address: settings.physical_address, verified_domain: settings.verified_domain, identities: snapshot.identities.map(({ id, sender_name, from_email, reply_to, is_default }) => ({ id, sender_name, from_email, reply_to, is_default })) } : null;
    const events = snapshot.events.map(({ payload, ...event }) => ({ ...event, clicked_url: event.event_type.replace(/^email\./, "") === "clicked" ? storedClickUrl(payload) : null }));
    return NextResponse.json({ campaigns: snapshot.campaigns, contacts: snapshot.contacts, settings: safeSettings, sending: { configured: Boolean(key), from_email: identity?.from_email ?? (settings?.from_email || null), status }, events, totals: snapshot.totals }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error(JSON.stringify({ scope: "dashboard_read", error: error instanceof Error ? error.name : "StorageError", code: (error as { code?: string }).code ?? null }));
    return NextResponse.json({ error: "Dashboard storage is unavailable. Displayed results may be outdated. Check the Supabase connection, then click Refresh." }, { status: 503 });
  }
}
