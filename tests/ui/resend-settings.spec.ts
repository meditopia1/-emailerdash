import { expect, test, type Page } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import type { EmailIntegration } from "../../apps/web/app/dashboard/email-integration-types";

const configuration = parseEnv(readFileSync(resolve("apps/web/.env.local"), "utf8"));
const artifacts = resolve("artifacts/ui"); mkdirSync(artifacts, { recursive: true });
test.beforeEach(async ({ context }) => {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now()/1000)+3600, nonce: "resend-ui-verification" })).toString("base64url");
  const signature = createHmac("sha256", configuration.ADMIN_SESSION_SECRET).update(payload).digest("base64url");
  await context.addCookies([{ name: "marketing_os_admin", value: `${payload}.${signature}`, url: "http://localhost:3001", httpOnly: true, sameSite: "Lax" }]);
});
async function openSetup(page: Page) {
  await page.goto("/"); await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("tab", { name: "Email setup" }).click();
  await expect(page.getByRole("heading", { name: "Resend connection", exact: true })).toBeVisible();
}
async function noOverflow(page: Page) { expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true); }
function mockData(): EmailIntegration { return {
  connection: { configured: true, state: "configuration_saved", credential_source: "encrypted_database", masked_key: "•••••••• (stored securely)", managed_domains: false, last_validated_at: null, last_test_at: null, error: null },
  domains: [], identities: [], tests: [], audit: [], webhook: { endpoint: "https://emailerdash.vercel.app/api/webhooks/resend/default", secret_configured: false, last_verified_event_at: null, health: "awaiting_verified_event" },
}; }

test("real settings load sanitized; no secrets or unauthenticated integration access", async ({ page, playwright }) => {
  const response = await page.request.get("/api/dashboard/settings/resend"); expect(response.status(), response.ok() ? "" : await response.text()).toBe(200);
  const body = await response.text();
  for (const key of ["RESEND_API_KEY", "RESEND_WEBHOOK_SIGNING_SECRET", "ENCRYPTION_MASTER_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) if (configuration[key]) expect(body).not.toContain(configuration[key]);
  expect(body).not.toContain("ciphertext"); expect(body).not.toContain("credential_version");
  const anon = await playwright.request.newContext({ baseURL: "http://localhost:3001" });
  expect((await anon.get("/api/dashboard/settings/resend")).status()).toBe(401); await anon.dispose();
  expect((await page.request.post("/api/dashboard/settings/resend", { headers: { origin: "https://untrusted.example" }, data: { action: "disconnect", confirmed: true } })).status()).toBe(403);
  expect((await page.request.post("/api/dashboard/settings/resend/test", { data: { destination: "operator@example.com" } })).status()).toBe(400);
  expect((await page.request.put("/api/dashboard/settings", { data: { resend_api_key: "must_not_overwrite" } })).status()).toBe(400);
  await openSetup(page);
  await expect(page.getByRole("heading", { name: "Sending domains", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your sending identity.", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tracking & testing", exact: true })).toBeVisible();
  await page.screenshot({ path: resolve(artifacts, "email-setup-light.png"), fullPage: true });
  await page.getByRole("tab", { name: "Appearance" }).click(); await page.getByRole("button", { name: "Dark", exact: true }).click();
  await page.getByRole("tab", { name: "Email setup" }).click(); await expect(page.getByRole("heading", { name: "Resend connection", exact: true })).toBeVisible();
  await page.screenshot({ path: resolve(artifacts, "email-setup-dark.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 }); await noOverflow(page);
  await page.screenshot({ path: resolve(artifacts, "email-setup-mobile.png"), fullPage: true });
});

test("mocked connection, manual domain, sender and explicit test; no implicit sends", async ({ page }) => {
  const data = mockData(); let tests = 0; const writes: string[] = []; let testPayload: Record<string, unknown> = {};
  const domainId = randomUUID(); const senderId = randomUUID();
  await page.route("**/api/dashboard/settings/resend", async route => {
    if (route.request().method() === "GET") return route.fulfill({ json: data });
    const body = route.request().postDataJSON(); writes.push(body.action);
    if (body.action === "connect") { expect(body.api_key).toBe("re_mock_ui_never_sent"); data.connection.state = "configuration_saved"; }
    if (body.action === "add_domain") data.domains.push({ id: domainId, domain: body.domain, provider_domain_id: null, verification_status: "self_reported", verification_source: "manual", is_default: false, evidence_current: false, last_checked_at: null, dns_records: [], open_tracking: null, click_tracking: null });
    if (body.action === "default_sender") data.identities[0].is_default = true;
    return route.fulfill({ json: { message: body.action === "connect" ? "Configuration saved, not validated." : "Configuration saved." } });
  });
  await page.route("**/api/dashboard/settings", async route => {
    const body = route.request().postDataJSON(); data.identities = [{ ...body, id: senderId, reply_to: body.reply_to, is_default: false, last_test_at: null, sending_validated: false, production_eligible: false }];
    return route.fulfill({ json: { message: "Sender saved. Explicit test required." } });
  });
  await page.route("**/api/dashboard/settings/resend/test", async route => { tests++; testPayload = route.request().postDataJSON(); data.connection.state = "connection_validated"; return route.fulfill({ json: { message: "Accepted by Resend. Inbox delivery is not confirmed.", provider_message_id: "mock-email-ui-1" } }); });
  page.on("dialog", dialog => dialog.accept());
  await openSetup(page); await page.getByLabel("Replacement Resend API key").fill("re_mock_ui_never_sent");
  await page.getByRole("button", { name: "Replace API key", exact: true }).click();
  await expect(page.getByLabel("Replacement Resend API key")).toHaveValue(""); await expect(page.getByText("Configuration saved, not validated.", { exact: true })).toBeVisible();
  expect(tests).toBe(0); await expect(page.getByRole("button", { name: "Load provider domains" })).toHaveCount(0);
  await page.getByLabel("Sending domain", { exact: true }).first().fill("updates.example.com");
  await page.getByRole("button", { name: "Link domain", exact: true }).click();
  await expect(page.getByText("Self-reported; DNS not checked", { exact: false })).toBeVisible();
  await page.getByLabel("Sender display name").fill("Example Marketing"); await page.getByLabel("From address", { exact: true }).fill("hello@updates.example.com");
  await page.getByLabel("Reply-to address").fill("support@example.com"); await page.getByLabel("Company name").fill("Example"); await page.getByLabel("Physical mailing address").fill("123 Example Lane");
  await page.getByRole("button", { name: "Save sender identity", exact: true }).click(); await expect(page.getByText("Explicit test required", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Make default sender", exact: true }).click();
  await expect(page.getByRole("button", { name: "Apply identity as default" })).toBeVisible(); expect(tests).toBe(0);
  await page.getByRole("button", { name: "Send test email", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Send test email" });
  await dialog.getByLabel("Test destination").fill("operator@example.com");
  await expect(dialog.getByRole("button", { name: "Confirm & send test" })).toBeDisabled();
  await dialog.getByLabel("I control or am authorized to use this destination mailbox.").check();
  await dialog.getByLabel("I confirm this sender and destination. Send one test email.").check();
  await dialog.getByRole("button", { name: "Confirm & send test" }).click();
  await expect(dialog.getByRole("status")).toContainText("Inbox delivery is not confirmed");
  expect(tests).toBe(1); expect(testPayload).toMatchObject({ sender_id: senderId, destination: "operator@example.com", confirmed: true, authorized_mailbox: true });
  expect(testPayload).not.toHaveProperty("audience_contact_ids"); expect(writes).toEqual(["connect", "add_domain", "default_sender"]);
});

test("mocked Full Access displays exact DNS evidence and tracking; mobile fits", async ({ page }) => {
  const data = mockData(); data.connection.managed_domains = true;
  data.domains.push({ id: randomUUID(), domain: "updates.example.com", provider_domain_id: "mock-provider-domain", verification_status: "pending", verification_source: "provider", evidence_current: true, is_default: false, last_checked_at: new Date().toISOString(), dns_records: [{ name: "mock._domainkey", type: "TXT", value: "MOCK_PROVIDER_DNS_VALUE", status: "pending", ttl: "Auto" }], open_tracking: false, click_tracking: false });
  await page.route("**/api/dashboard/settings/resend", async route => {
    if (route.request().method() === "GET") return route.fulfill({ json: data });
    const body = route.request().postDataJSON();
    if (body.action === "refresh_domain") data.domains[0].verification_status = "verified";
    if (body.action === "tracking") { data.domains[0].open_tracking = body.open_tracking; data.domains[0].click_tracking = body.click_tracking; }
    return route.fulfill({ json: { message: "Provider response recorded." } });
  }); page.on("dialog", dialog => dialog.accept());
  await openSetup(page); await page.getByText("Exact DNS records from Resend (1)").click(); await expect(page.locator("code").filter({ hasText: "MOCK_PROVIDER_DNS_VALUE" })).toBeVisible();
  await page.getByRole("button", { name: "Refresh status", exact: true }).click(); await expect(page.getByText("verified · provider evidence current", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Enable opens & clicks", exact: true }).click(); await expect(page.getByText("Opens: Enabled by Resend", { exact: false })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 }); await noOverflow(page);
  await page.getByRole("button", { name: "Send test email", exact: true }).click(); await noOverflow(page);
  await expect(page.getByRole("dialog", { name: "Send test email" })).toBeVisible();
  await page.getByRole("button", { name: "Close test dialog" }).click();
});

test("failed mocked validation preserves entered key and never implies connection success", async ({ page }) => {
  await page.route("**/api/dashboard/settings/resend", route => route.request().method() === "GET" ? route.fulfill({ json: mockData() }) : route.fulfill({ status: 422, json: { error: "Resend rejected the API key. Replace it with an active key." } }));
  page.on("dialog", dialog => dialog.accept());
  await openSetup(page); await page.getByLabel("Replacement Resend API key").fill("re_mock_invalid_key"); await page.getByRole("button", { name: "Replace API key" }).click();
  await expect(page.getByRole("status")).toContainText("Resend rejected the API key"); await expect(page.getByLabel("Replacement Resend API key")).toHaveValue("re_mock_invalid_key");
  await expect(page.locator(".connection-summary")).not.toContainText("connection validated");
});

test("helpful sender errors show matching examples, focus fields and preserve entries", async ({ page }) => {
  const data = mockData(); let saves = 0;
  data.domains.push({ id: randomUUID(), domain: "day1main.com", provider_domain_id: "mock-domain", verification_status: "verified", verification_source: "provider", evidence_current: true, is_default: false, last_checked_at: new Date().toISOString(), dns_records: [], open_tracking: null, click_tracking: null });
  await page.route("**/api/dashboard/settings/resend", route => route.fulfill({ json: data }));
  await page.route("**/api/dashboard/settings", async route => {
    saves++;
    return route.fulfill({ status: 409, json: { error: "This From address already has a sender identity. Choose Edit identity below.", field_errors: { from_email: "This From address already has a sender identity. Choose Edit identity below." } } });
  });
  await openSetup(page);
  await page.getByLabel("Sender display name").fill("Example team");
  await page.getByLabel("Company name", { exact: true }).fill("Example company");
  await page.getByLabel("Physical mailing address").fill("123 Example Lane, Singapore");
  const from = page.getByLabel("From address", { exact: true });
  await from.fill("support@other.example");
  await page.getByRole("button", { name: "Save sender identity", exact: true }).click();
  await expect(from).toBeFocused(); await expect(from).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator(".os-field-error")).toContainText("Your selected sending domain is day1main.com");
  await expect(page.locator(".os-field-error")).toContainText("support@day1main.com");
  await expect(from).toHaveValue("support@other.example");
  await expect(page.getByLabel("Company name", { exact: true })).toHaveValue("Example company");
  expect(saves).toBe(0);
  await page.locator("section").filter({ has: page.getByRole("heading", { name: "Your sending identity.", exact: true }) }).screenshot({ path: resolve(artifacts, "email-setup-actionable-error.png") });
  await from.fill("support@day1main.com");
  await page.getByRole("button", { name: "Save sender identity", exact: true }).click();
  await expect(page.locator(".os-field-error")).toContainText("Choose Edit identity below");
  await expect(from).toBeFocused(); await expect(from).toHaveValue("support@day1main.com");
  expect(saves).toBe(1);
});

test("domain guidance distinguishes email addresses and empty provider results", async ({ page }) => {
  const data = mockData(); data.connection.managed_domains = true; const writes: string[] = [];
  await page.route("**/api/dashboard/settings/resend", route => {
    if (route.request().method() === "GET") return route.fulfill({ json: data });
    const body = route.request().postDataJSON(); writes.push(body.action);
    return route.fulfill({ json: { provider_domains: [], has_more: false } });
  });
  await openSetup(page);
  const domain = page.getByLabel("Sending domain", { exact: true }).first();
  await domain.fill("support@day1main.com"); await page.getByRole("button", { name: "Link domain", exact: true }).click();
  await expect(domain).toBeFocused(); await expect(domain).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator(".os-field-error")).toContainText("Enter just day1main.com");
  expect(writes).toEqual([]);
  await page.getByLabel("Domain connection method").selectOption("link");
  await page.getByRole("button", { name: "Load provider domains" }).click();
  await expect(page.getByRole("status")).toContainText("Resend returned no domains");
  await expect(page.getByRole("status")).toContainText("Replace API key first");
  expect(writes).toEqual(["list_provider_domains"]);
});

test("confirmed sender save stays successful when its status refresh fails", async ({ page }) => {
  const data = mockData(); const domainId = randomUUID(); const senderId = randomUUID(); let saved = false; let writes = 0;
  data.domains.push({ id: domainId, domain: "example.com", provider_domain_id: null, verification_status: "self_reported", verification_source: "manual", evidence_current: false, is_default: false, last_checked_at: null, dns_records: [], open_tracking: null, click_tracking: null });
  await page.route("**/api/dashboard/settings/resend", route => saved ? route.fulfill({ status: 503, json: { error: "Status refresh unavailable" } }) : route.fulfill({ json: data }));
  await page.route("**/api/dashboard/settings", route => { writes++; saved = true; return route.fulfill({ json: { id: senderId, message: "Sender saved. Next: send a test explicitly." } }); });
  await openSetup(page);
  await page.getByLabel("Sender display name").fill("Example team"); await page.getByLabel("From address", { exact: true }).fill("hello@example.com");
  await page.getByLabel("Company name", { exact: true }).fill("Example"); await page.getByLabel("Physical mailing address").fill("123 Example Lane");
  await page.getByRole("button", { name: "Save sender identity", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Sender saved");
  await expect(page.locator(".email-setup-main > [role=alert]")).toContainText("Your sender was saved, but the status refresh failed");
  await expect(page.getByRole("button", { name: "Save identity changes", exact: true })).toBeEnabled();
  await expect(page.getByLabel("From address", { exact: true })).toHaveValue("hello@example.com"); expect(writes).toBe(1);
});
