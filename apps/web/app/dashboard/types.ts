export type Campaign = {
  id: string; name: string; status: string; total_count: number; accepted_count: number;
  delivered_count: number; opened_count: number; clicked_count: number;
  failed_count: number; blocked_count: number; created_at: string; started_at?: string | null; completed_at?: string | null;
  recipient_count?: number | null; queued_count?: number | null; processed_count?: number | null;
};
export type CampaignRecipient = { id: string; email: string; name: string | null; status: string; error_message?: string | null; accepted_at?: string | null; delivered_at?: string | null; latest_event_at?: string | null };
export type CampaignDetail = { campaign: Campaign & { sender_name: string; from_email: string; subject: string; content_html: string | null; content_text: string | null }; recipients: CampaignRecipient[] };
export type Contact = { id: string; email: string; name: string | null; consent_source: string; consented_at: string; imported_at: string; eligible?: boolean; reason?: string | null };
export type SenderChoice = { id: string; sender_name: string; from_email: string; reply_to: string | null; is_default: boolean };
export type SenderSettings = { sender_name: string; from_email: string; reply_to: string | null; company_name: string; physical_address: string; verified_domain?: string | null; identities?: SenderChoice[] };
export type MailEvent = { id?: string; event_type: string; email?: string | null; event_at?: string; campaign_id?: string | null; campaign_name?: string | null; clicked_url?: string | null };
export type Overview = { campaigns: Campaign[]; contacts: Contact[]; settings: SenderSettings | null; events: MailEvent[]; totals: Record<string, number>; sending?: { configured: boolean; from_email: string | null; status: string } };
export type Section = "Overview" | "Compose & Send" | "Active Sending" | "Campaign History" | "Recipient Activity" | "Contacts" | "Suppressions" | "Email Setup" | "Settings";

export class ApiRequestError extends Error {
  constructor(message: string, public fieldErrors: Record<string, string> = {}, public uncertain = false) { super(message); }
}

export async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const readOnly = ["GET", "HEAD"].includes((init?.method ?? "GET").toUpperCase());
  const timeout = AbortSignal.timeout(readOnly ? 12000 : 30000);
  try {
    const response = await fetch(path, { ...init, cache: "no-store", signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout, headers: { "content-type": "application/json", ...init?.headers } });
    if (response.status === 401) { window.location.assign("/login"); throw new ApiRequestError("Your session expired. Please sign in again."); }
    const result = await response.json().catch(() => {
      if (timeout.aborted) throw timeout.reason;
      throw new ApiRequestError(readOnly ? "The server returned an unexpected response. Refresh this page once the development server is ready." : "The server did not return a save confirmation. Keep your entries and check the saved list before trying again; the change may already have completed.", {}, !readOnly);
    });
    if (!response.ok) throw new ApiRequestError(result.error || "The server could not complete this step. Keep your entries and check the saved list before trying again.", result.field_errors && typeof result.field_errors === "object" ? Object.fromEntries(Object.entries(result.field_errors).filter((entry): entry is [string, string] => typeof entry[1] === "string")) : {}, !readOnly && response.status >= 500);
    return result as T;
  } catch (error) {
    if (init?.signal?.aborted) throw error;
    if (error instanceof ApiRequestError) throw error;
    if (timeout.aborted) throw new ApiRequestError(readOnly ? "Loading took too long. Any displayed results may be outdated; check your connection and try Refresh again." : "The server did not confirm the save in time. It may have completed. Keep your entries and refresh the saved list before trying again. No automatic retry was made.", {}, !readOnly);
    throw new ApiRequestError(readOnly ? "The server could not be reached. Check your connection and try Refresh again." : "Connection interrupted before confirmation. Your change may have completed; check the saved list before trying again. No automatic retry was made.", {}, !readOnly);
  }
}

export function formatNumber(value: number) { return new Intl.NumberFormat("en").format(value); }
export function statusLabel(value: string) { return value.replaceAll("_", " "); }
