import { z } from "zod";
import { createHash } from "node:crypto";

export function environmentCredentialCurrent(storedFingerprint: string | null | undefined, key: string) {
  const fingerprint = createHash("sha256").update(`marketing-os-resend-env:${key}`).digest("hex");
  return { fingerprint, current: storedFingerprint === fingerprint };
}

export class IntegrationError extends Error {
  constructor(message: string, public status = 400, public field?: string) { super(message); }
}

const dnsRecord = z.object({ name: z.string().max(1000), type: z.string().max(30), value: z.string().max(16000), record: z.string().optional(), priority: z.number().optional(), ttl: z.union([z.string(), z.number()]).optional(), status: z.string().optional() });
export const providerDomain = z.object({ id: z.string().min(1).max(200), name: z.string().max(253), status: z.string().max(80), records: z.array(dnsRecord).max(100).optional(), open_tracking: z.boolean().optional(), click_tracking: z.boolean().optional() });
export type ProviderDomain = z.infer<typeof providerDomain>;

/** One bounded transport; only fixed Resend API paths, never a client-provided URL. */
export class ResendProvider {
  constructor(private key: string, private transport: typeof fetch = fetch) {}
  async call(path: string, method = "GET", body?: unknown, idempotencyKey?: string): Promise<unknown> {
    let response: Response;
    try {
      response = await this.transport(`https://api.resend.com${path}`, { method, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(8000), headers: { Authorization: `Bearer ${this.key}`, "Content-Type": "application/json", ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    } catch { throw new IntegrationError(path === "/emails" ? "Resend could not be reached. A timed-out test may still have been accepted. Check Recent explicit tests and Resend Emails before sending another; do not immediately resend." : "Resend could not be reached. Your entries are still here. Check your connection and Resend service health, then retry Load provider domains or Refresh status. If you were creating a domain, check Resend Domains first and import it if it already exists.", 503); }
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      // Never relay raw provider messages: they can contain addresses, keys or request data.
      const name = data && typeof data.name === "string" ? data.name : "";
      if (response.status === 401 || name === "invalid_api_key") throw new IntegrationError("Resend rejected the API key. Create or copy an active key in Resend API keys, paste it in Replacement Resend API key, then click Replace API key. Saving the management checkbox alone does not save a new key.", 422);
      if (response.status === 403) throw new IntegrationError(path === "/emails" ? "Resend denied permission to send this test. Check that the saved key allows the exact From domain and that the domain is verified in Resend. For onboarding@resend.dev, use the test recipient allowed by your Resend account." : "Resend denied permission to manage domains. Use a Full Access key from the same Resend team as your domain, paste it above and click Replace API key, then enable and save managed domain setup. Alternatively, use the manual domain method with a Sending Access key.", 422);
      if (response.status === 429) throw new IntegrationError("Resend rate limit reached. Wait before retrying.", 429);
      if (response.status === 404) throw new IntegrationError("This domain is not available in the connected Resend account. Check the account and provider domain ID.", 422);
      if (response.status === 409 || name === "domain_already_exists") throw new IntegrationError("Resend reports a conflict. Link the existing domain from this account; domains are never transferred automatically.", 409);
      if (response.status >= 500) throw new IntegrationError("Resend is temporarily unavailable. Check provider health before retrying.", 503);
      throw new IntegrationError("Resend rejected the request. Check domain verification, sender, test-recipient restrictions and account limits in Resend.", 422);
    }
    return data;
  }
  async listDomains(after?: string) {
    return z.object({ data: z.array(providerDomain).max(100), has_more: z.boolean().optional() }).parse(await this.call(`/domains?limit=100${after ? `&after=${encodeURIComponent(after)}` : ""}`));
  }
  async getDomain(id: string) { return providerDomain.parse(await this.call(`/domains/${encodeURIComponent(id)}`)); }
  async createDomain(name: string) { return providerDomain.parse(await this.call("/domains", "POST", { name })); }
  async verifyDomain(id: string) { await this.call(`/domains/${encodeURIComponent(id)}/verify`, "POST"); }
  async updateTracking(id: string, open_tracking: boolean, click_tracking: boolean) { await this.call(`/domains/${encodeURIComponent(id)}`, "PATCH", { open_tracking, click_tracking }); return this.getDomain(id); }
  async sendTest(input: { from: string; to: string; reply_to?: string; subject: string; text?: string; html?: string }, id: string) {
    return z.object({ id: z.string().min(1).max(200) }).parse(await this.call("/emails", "POST", { ...input, to: [input.to], subject: `[TEST] ${input.subject}` }, `marketing-os-test/${id}`));
  }
}
