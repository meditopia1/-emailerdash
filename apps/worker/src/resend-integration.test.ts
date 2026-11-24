import { describe, expect, it, vi } from "vitest";
import { environmentCredentialCurrent, ResendProvider } from "../../web/lib/resend-provider";
import { verifyWebhookSignature } from "../../web/lib/webhook";
import { decryptSecret, encryptSecret } from "../../web/lib/crypto";
import { createHmac } from "node:crypto";
import { newDraft, campaignDraft, type BuilderCampaign } from "../../web/app/campaign-builder/model";

function mockResponse(body: unknown, status = 200) { return vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })); }
const domain = { id: "provider-domain-1", name: "updates.example.com", status: "verified", open_tracking: true, click_tracking: false, records: [{ name: "resend._domainkey", type: "TXT", value: "actual-provider-dkim", status: "verified" }] };

describe("bounded Resend transport (no real provider requests)", () => {
  it("invalidates proof when an environment key changes outside Settings", () => {
    const original = environmentCredentialCurrent(null, "re_environment_original");
    expect(original.current).toBe(false); expect(original.fingerprint).not.toContain("re_environment_original");
    expect(environmentCredentialCurrent(original.fingerprint, "re_environment_original").current).toBe(true);
    expect(environmentCredentialCurrent(original.fingerprint, "re_environment_rotated").current).toBe(false);
  });
  it("submits exactly one test with prefix and idempotency; no management lookup", async () => {
    const transport = mockResponse({ id: "email-1" }); const provider = new ResendProvider("re_mock_do_not_send", transport);
    expect(await provider.sendTest({ from: "Example <hello@updates.example.com>", to: "operator@example.com", subject: "Preview", text: "Test content" }, "test-1")).toEqual({ id: "email-1" });
    expect(transport).toHaveBeenCalledTimes(1);
    const [url, options] = transport.mock.calls[0]; expect(url).toBe("https://api.resend.com/emails");
    expect(JSON.parse(String(options?.body))).toMatchObject({ subject: "[TEST] Preview", to: ["operator@example.com"] });
    expect(options?.headers).toMatchObject({ "Idempotency-Key": "marketing-os-test/test-1" });
    expect(options?.signal).toBeDefined(); expect(options?.redirect).toBe("error");
  });
  it.each([[401,"API key"], [403,"permission"], [429,"rate limit"], [409,"conflict"], [404,"not available"], [500,"temporarily unavailable"], [422,"rejected"]])("sanitizes provider failure %s", async (status, text) => {
    const provider = new ResendProvider("re_mock_secret", mockResponse({ message: "LEAK re_mock_secret operator@example.com", name: "provider_error" }, Number(status)));
    await expect(provider.getDomain("domain-1")).rejects.toThrow(String(text));
    await expect(provider.getDomain("domain-1")).rejects.not.toThrow("LEAK");
  });
  it("handles network failures without exposing request details", async () => {
    const transport = vi.fn<typeof fetch>().mockRejectedValue(new Error("re_secret leaked request"));
    await expect(new ResendProvider("re_secret", transport).getDomain("x")).rejects.toThrow("could not be reached");
  });
  it("gives permission guidance for the operation that actually failed", async () => {
    const provider = new ResendProvider("re_mock_secret", mockResponse({}, 403));
    await expect(provider.listDomains()).rejects.toThrow("click Replace API key");
    await expect(provider.sendTest({ from: "Example <hello@example.com>", to: "operator@example.com", subject: "Preview", text: "Example" }, "mock-guidance")).rejects.toThrow("exact From domain");
  });
  it("only warns about ambiguous acceptance when an email was attempted", async () => {
    const transport = vi.fn<typeof fetch>().mockRejectedValue(new Error("offline"));
    const provider = new ResendProvider("re_mock_secret", transport);
    await expect(provider.listDomains()).rejects.toThrow("retry Load provider domains");
    await expect(provider.listDomains()).rejects.not.toThrow("accepted");
    await expect(provider.sendTest({ from: "Example <hello@example.com>", to: "operator@example.com", subject: "Preview", text: "Example" }, "mock-offline")).rejects.toThrow("do not immediately resend");
  });
  it("reads exact provider DNS records and paginates domains", async () => {
    const transport = mockResponse({ data: [domain], has_more: true });
    const result = await new ResendProvider("re_mock", transport).listDomains("last/domain");
    expect(result.data[0].records).toEqual(domain.records); expect(result.has_more).toBe(true);
    expect(transport.mock.calls[0][0]).toBe("https://api.resend.com/domains?limit=100&after=last%2Fdomain");
  });
  it("creates, reads, verifies and updates tracking using supported paths", async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async (_url, options) => new Response(JSON.stringify(options?.method === "POST" && String(_url).endsWith("/verify") ? { object: "domain", id: domain.id } : domain)));
    const provider = new ResendProvider("re_mock", transport);
    expect(await provider.createDomain(domain.name)).toMatchObject(domain);
    await provider.verifyDomain(domain.id); expect(await provider.updateTracking(domain.id, true, false)).toMatchObject(domain);
    const calls = transport.mock.calls;
    expect(calls.map(([url]) => url)).toEqual(["https://api.resend.com/domains", `https://api.resend.com/domains/${domain.id}/verify`, `https://api.resend.com/domains/${domain.id}`, `https://api.resend.com/domains/${domain.id}`]);
    expect(JSON.parse(String(calls[2][1]?.body))).toEqual({ open_tracking: true, click_tracking: false });
  });
});

describe("Svix raw-body verification", () => {
  const secret = "whsec_plJ3nmyCDGBKInavdOK15jsl";
  const payload = '{"event_type":"ping","data":{"success":true}}';
  const headers = { id: "msg_loFOjxBNrRLzqYUf", timestamp: "1731705121", signature: "v1,rAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0=" };
  it("matches the official Svix test vector", () => { expect(verifyWebhookSignature(payload, headers, secret, 1731705121000)).toBe(true); });
  it("rejects replay, future timestamps, missing headers, mutations and wrong secrets", () => {
    expect(verifyWebhookSignature(payload, headers, secret, 1731705422000)).toBe(false);
    expect(verifyWebhookSignature(payload, headers, secret, 1731704820000)).toBe(false);
    expect(verifyWebhookSignature(payload + " ", headers, secret, 1731705121000)).toBe(false);
    expect(verifyWebhookSignature(payload, { ...headers, id: "" }, secret, 1731705121000)).toBe(false);
    expect(verifyWebhookSignature(payload, headers, "whsec_differentdifferentdifferent", 1731705121000)).toBe(false);
  });
  it("accepts a valid v1 signature during signature rotation", () => {
    const now = Math.floor(Date.now()/1000); const raw = '{"type":"email.opened"}'; const signature = createHmac("sha256", Buffer.from(secret.slice(6), "base64")).update(`msg_test.${now}.${raw}`).digest("base64");
    expect(verifyWebhookSignature(raw, { id: "msg_test", timestamp: String(now), signature: `v2,ignored v1,invalid v1,${signature}` }, secret)).toBe(true);
  });
});

describe("authenticated credential encryption", () => {
  it("uses randomized ciphertext and rejects tampering or a different master key", () => {
    const first = encryptSecret("re_test_credential", "master-one"); const second = encryptSecret("re_test_credential", "master-one");
    expect(first).not.toBe(second); expect(first).not.toContain("re_test_credential"); expect(decryptSecret(first, "master-one")).toBe("re_test_credential");
    expect(() => decryptSecret(first, "master-two")).toThrow();
    const [iv, tag, encrypted] = first.split("."); const mutated = Buffer.from(encrypted, "base64url"); mutated[0] ^= 1;
    expect(() => decryptSecret([iv, tag, mutated.toString("base64url")].join("."), "master-one")).toThrow();
    expect(decryptSecret(encryptSecret("", "master-one"), "master-one")).toBe("");
  });
});

it("new campaigns use the configured default; historical sender snapshots remain unchanged", () => {
  const settings = { sender_name: "New Default", from_email: "hello@new.example.com", reply_to: "reply@example.com", company_name: "Example", physical_address: "Example address" };
  expect(newDraft(settings)).toMatchObject({ sender_name: "New Default", from_email: "hello@new.example.com" });
  const old = { name: "Existing draft", sender_name: "Historical sender", from_email: "hello@old.example.com", reply_to: null, subject: "Existing", preheader: null, content_text: "Existing", content_html: null, audience_contact_ids: [] } as unknown as BuilderCampaign;
  expect(campaignDraft(old)).toMatchObject({ sender_name: "Historical sender", from_email: "hello@old.example.com" });
});
