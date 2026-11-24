import { expect, test, type Page } from "@playwright/test";
import { createHmac } from "node:crypto";
import { readFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { deriveSetup, type SetupEvidence, type SetupSnapshot } from "../../apps/web/lib/guided-setup";
import { campaignCapabilities } from "../../apps/web/lib/campaign-capabilities";
import type { Overview } from "../../apps/web/app/dashboard/types";
import type { EmailIntegration } from "../../apps/web/app/dashboard/email-integration-types";
import { mockAudienceData } from "./audience-fixtures";
const env = parseEnv(readFileSync(resolve("apps/web/.env.local"), "utf8"));
const artifacts = resolve("artifacts/ui"); mkdirSync(artifacts, { recursive: true });
const empty = (): SetupEvidence => ({ connection: { configured: false, validated: false, failed: false, webhookConfigured: false, webhookReceived: false }, facts: { domains: [], identities: [], contacts: { total: 0, eligible: 0 }, draft: null, submitted: false } });
const complete = (): SetupEvidence => ({ connection: { configured: true, validated: true, failed: false, webhookConfigured: true, webhookReceived: true }, facts: { domains: [{ id: "domain", domain: "example.com", verified: true, manual: false, tracking: true, failed: false }], identities: [{ domain_id: "domain", from_email: "hello@example.com", valid: true, tested: true, is_default: true }], contacts: { total: 2, eligible: 1 }, draft: { id: "11111111-1111-4111-8111-111111111111", name: "Saved campaign", from_email: "hello@example.com", content_valid: true, audience_configured: true, audience_verified: true, eligible: 1, excluded: 1, approved: true }, submitted: true } });
const overview: Overview = { campaigns: [], contacts: [], settings: null, events: [], totals: { contacts: 0, campaigns: 0, delivered: 0, opened_delivered: 0, suppressed: 0, sending_campaigns: 0 } };
const integration: EmailIntegration = { connection: { configured: false, state: "not_configured", credential_source: null, masked_key: null, managed_domains: false, last_validated_at: null, last_test_at: null, error: null }, domains: [], identities: [], tests: [], audit: [], webhook: { endpoint: "https://emailerdash.vercel.app/api/webhooks/resend/default", secret_configured: false, last_verified_event_at: null, health: "awaiting_verified_event" } };
test.beforeEach(async ({ context }) => {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600, nonce: "guided-setup" })).toString("base64url");
  const signature = createHmac("sha256", env.ADMIN_SESSION_SECRET).update(payload).digest("base64url");
  await context.addCookies([{ name: "marketing_os_admin", value: `${payload}.${signature}`, url: "http://localhost:3001", httpOnly: true, sameSite: "Lax" }]);
});
async function fixtures(page: Page, snapshot: () => SetupSnapshot = () => deriveSetup(empty(), campaignCapabilities)) {
  await page.route("**/api/dashboard/overview*", route => route.fulfill({ json: overview }));
  await page.route("**/api/dashboard/setup", route => route.fulfill({ json: snapshot() }));
  await page.route("**/api/dashboard/settings/resend", route => route.fulfill({ json: integration }));
  await page.route("**/api/dashboard/contacts?*", route => route.fulfill({ json: { contacts: [], count: 0, page: 0, page_size: 25, resources: { fields: [], tags: [], segments: [], lists: [] }, metrics: { total: 0, eligible: 0, unsubscribed: 0, suppressed: 0 } } }));
}
async function loaded(page: Page) { await page.goto("/"); await expect(page.getByRole("heading", { name: "Let's get things moving.", exact: true })).toBeVisible(); await expect(page.getByRole("progressbar", { name: "Verified setup steps" })).toHaveAttribute("aria-valuenow"); }
async function noOverflow(page: Page) { expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true); }

test("first-time checklist explains the next step without blocking the homepage", async ({ page }) => {
  await fixtures(page); await loaded(page);
  await expect(page.getByRole("heading", { name: "Let's get you ready to send.", exact: true })).toBeVisible();
  await expect(page.locator(".setup-steps>li")).toHaveCount(7);
  await expect(page.locator(".setup-progress-row")).toContainText("0 of 7 complete");
  await expect(page.locator(".setup-dispatch-note")).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready); await noOverflow(page);
  await page.screenshot({ path: resolve(artifacts, "guided-dashboard-desktop.png"), fullPage: true });
  await page.getByRole("button", { name: "Continue setup", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Resend connection", exact: true })).toBeVisible();
  await expect(page.locator("#setup-connection")).toBeFocused();
});

test("saved key, pending domain, missing sender, webhook evidence and eligibility remain distinct", async ({ page }) => {
  const e = empty(); e.connection!.configured = true; e.connection!.webhookConfigured = true; e.facts!.domains = [{ id: "domain", domain: "example.com", verified: false, manual: true, tracking: false, failed: false }]; e.facts!.contacts = { total: 4, eligible: 0 };
  await fixtures(page, () => deriveSetup(e, campaignCapabilities)); await loaded(page);
  await expect(page.locator(".setup-step").filter({ hasText: "Connect your email provider" })).toContainText("In progress");
  await expect(page.locator(".setup-step").filter({ hasText: "Verify your sending domain" })).toContainText("In progress");
  await expect(page.locator(".setup-step").filter({ hasText: "Set up your sending identity" })).toContainText("Not started");
  await expect(page.locator(".setup-step").filter({ hasText: "Track your email activity" })).toContainText("In progress");
  await expect(page.locator(".setup-step").filter({ hasText: "Build your audience" })).toContainText("none are eligible");
});

test("minimizing persists across reload and critical launch blocker stays visible", async ({ page }) => {
  await fixtures(page); await loaded(page);
  await page.getByRole("button", { name: "Minimize setup checklist" }).click();
  await expect(page.locator("#setup-checklist-body")).toBeHidden();
  await page.reload(); await expect(page.getByRole("button", { name: "Expand setup checklist" })).toBeVisible();
  await expect(page.locator(".setup-dispatch-note")).toHaveCount(0);
  await page.getByRole("button", { name: "Help", exact: true }).click();
  await page.getByRole("button", { name: "Show setup checklist" }).click();
  await expect(page.locator("#setup-checklist-body")).toBeVisible();
});

test("completion collapses once and remains inspectable", async ({ page }) => {
  await fixtures(page, () => deriveSetup(complete(), campaignCapabilities)); await loaded(page);
  await expect(page.getByRole("heading", { name: "Your workspace is set up." })).toBeVisible();
  await expect(page.locator("#setup-checklist-body")).toBeHidden();
  await expect(page.locator(".setup-dispatch-note")).toHaveCount(0);
  await page.getByRole("button", { name: "Expand setup checklist" }).click();
  await expect(page.locator(".setup-progress-row")).toContainText("7 of 7 complete");
  await page.reload(); await expect(page.locator("#setup-checklist-body")).toBeVisible();
});

test("unavailable checks stay unknown with a recoverable retry", async ({ page }) => {
  await fixtures(page); let failed = true;
  await page.route("**/api/dashboard/setup", route => failed ? route.fulfill({ status: 503, json: { error: "Setup storage is temporarily unavailable. Retry the check." } }) : route.fulfill({ json: deriveSetup(empty(), campaignCapabilities) }));
  await loaded(page); await expect(page.locator(".setup-step.unable_to_verify")).toHaveCount(7);
  await expect(page.getByRole("heading", { name: "Let's get things moving.", exact: true })).toBeVisible();
  failed = false; await page.getByRole("button", { name: "Retry setup check", exact: true }).click();
  await expect(page.locator(".setup-step.unable_to_verify")).toHaveCount(0);
  await expect(page.locator(".setup-step.not_started")).toHaveCount(7);
});

test("help is contextual, keyboard accessible and preserves an unsaved campaign", async ({ page }) => {
  await fixtures(page); await loaded(page); await page.getByRole("button", { name: "Compose & Send", exact: true }).click();
  await page.getByLabel("Campaign name", { exact: true }).fill("Unsaved campaign remains here");
  await page.getByRole("button", { name: "Help", exact: true }).click();
  const help = page.getByRole("dialog", { name: "Help centre" });
  await expect(help.getByRole("heading", { name: "Build a saved campaign" })).toBeVisible();
  await expect(help.getByRole("heading", { name: "Campaign Start", exact: true })).toBeVisible();
  await page.screenshot({ path: resolve(artifacts, "guided-help-builder.png"), fullPage: true });
  await page.keyboard.press("Tab"); await expect(help.locator(":focus")).toHaveCount(1);
  await page.keyboard.press("Escape"); await expect(help).toBeHidden();
  await expect(page.getByLabel("Campaign name", { exact: true })).toHaveValue("Unsaved campaign remains here");
  await expect(page.getByRole("button", { name: "Help", exact: true })).toBeFocused();
});

test("email help explains exact From domain and opens its real sender section", async ({ page }) => {
  await fixtures(page); await loaded(page); await page.getByRole("button", { name: "Help", exact: true }).click();
  const help = page.getByRole("dialog", { name: "Help centre" });
  await help.getByRole("button", { name: "Set up your sending identity", exact: true }).click();
  await expect(help.getByRole("heading", { name: "Match the From domain" })).toBeVisible();
  await expect(help).toContainText("Edit identity");
  await help.getByRole("button", { name: "Open Email Setup", exact: true }).click();
  await expect(help).toBeHidden(); await expect(page.locator("#setup-sender")).toBeFocused();
});

test("contacts tour highlights real controls, previous/next/skip/restart and cleanup work", async ({ page }) => {
  await fixtures(page); await loaded(page); await page.getByRole("button", { name: "Contacts", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Audience contacts", exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Help", exact: true }).click(); await page.getByRole("button", { name: "Start walkthrough" }).click();
  const tour = page.getByRole("dialog", { name: "Contacts walkthrough" });
  await expect(tour.getByRole("heading", { name: "Add one contact" })).toBeVisible();
  await expect(page.locator('[data-guide="contact-add"]')).toHaveClass(/guide-highlight/);
  await page.screenshot({ path: resolve(artifacts, "guided-contacts-tour-desktop.png") });
  await tour.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.locator('[data-guide="contact-import"]')).toHaveClass(/guide-highlight/);
  await tour.getByRole("button", { name: "Previous" }).click();
  await expect(tour.getByRole("heading", { name: "Add one contact" })).toBeVisible();
  for (let i = 0; i < 4; i++) await tour.getByRole("button", { name: "Next", exact: true }).click();
  await tour.getByRole("button", { name: "Finish" }).click(); await expect(tour).toBeHidden();
  await expect(page.locator(".guide-highlight")).toHaveCount(0);
  await page.getByRole("button", { name: "Help", exact: true }).click(); await page.getByRole("button", { name: "Restart walkthrough" }).click();
  await expect(tour).toBeVisible(); await tour.getByRole("button", { name: "Skip tour" }).click(); await expect(tour).toBeHidden();
  await page.getByRole("button", { name: "Overview", exact: true }).click(); await expect(page.getByRole("heading", { name: "Let's get things moving.", exact: true })).toBeVisible();
});

test("mobile dark theme, custom accent and reduced motion keep help usable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => { localStorage.setItem("marketing-os-appearance", JSON.stringify({ theme: "dark", accent: "#dad0e8" })); });
  await fixtures(page); await loaded(page); await noOverflow(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({ path: resolve(artifacts, "guided-dashboard-mobile-dark.png"), fullPage: true });
  await page.getByRole("button", { name: "Minimize setup checklist" }).click();
  await page.getByRole("button", { name: "Contacts", exact: true }).click();
  await page.getByRole("button", { name: "Help", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Build an eligible audience" })).toBeVisible(); await noOverflow(page);
  await page.screenshot({ path: resolve(artifacts, "guided-help-mobile-dark.png"), fullPage: true });
  await page.getByRole("button", { name: "Start walkthrough" }).click();
  const tour = page.getByRole("dialog", { name: "Contacts walkthrough" }); await expect(tour).toBeVisible();
  await expect(page.locator('[data-guide="contact-add"]')).toHaveClass(/guide-highlight/); await noOverflow(page);
  const box = await tour.boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: resolve(artifacts, "guided-tour-mobile-dark.png") });
  await page.keyboard.press("Escape"); await expect(tour).toBeHidden(); await expect(page.locator(".guide-highlight")).toHaveCount(0);
});

test("status refreshes after acknowledged changes without provider polling", async ({ page }) => {
  let e = empty(); let reads = 0;
  await fixtures(page, () => { reads++; return deriveSetup(e, campaignCapabilities); }); await loaded(page);
  await page.getByRole("button", { name: "Contacts", exact: true }).click(); await page.getByRole("button", { name: "Overview", exact: true }).click();
  expect(reads).toBe(1);
  e = complete(); e.facts!.submitted = false;
  await page.evaluate(() => window.dispatchEvent(new Event("marketing-os:setup-updated")));
  await expect(page.locator(".setup-progress-row")).toContainText("6 of 7 complete");
  expect(reads).toBe(2); await expect(page.locator(".setup-dispatch-note")).toHaveCount(0);
});

test("readiness explains backend and tracking separately; guides never send", async ({ page }) => {
  const writes: string[] = [];
  page.on("request", request => { if (request.url().includes("/api/") && request.method() !== "GET") writes.push(request.url()); });
  await fixtures(page, () => deriveSetup(complete(), campaignCapabilities)); await loaded(page);
  await page.getByRole("button", { name: "Help", exact: true }).click();
  const help = page.getByRole("dialog", { name: "Help centre" });
  await help.getByText("Saved-draft sending checks", { exact: false }).click();
  await expect(help).toContainText("Launching creates a durable recipient queue"); await expect(help).toContainText("Tracking: Complete");
  await help.getByRole("button", { name: "Launch your first campaign", exact: true }).click();
  await expect(help.getByRole("heading", { name: "Review before a real launch" })).toBeVisible();
  await expect(help).toContainText("persistent worker claims recipient jobs");
  expect(writes).toEqual([]);
});

test("real authenticated setup API is read-only, private and secret-free", async ({ page, playwright }) => {
  const response = await page.request.get("/api/dashboard/setup"); expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("private, no-store");
  const text = await response.text(); const data = JSON.parse(text) as SetupSnapshot;
  expect(data.verification).toBe("verified"); expect(data.steps).toHaveLength(7); expect(data.readiness.ready).toBe(false);
  for (const key of ["RESEND_API_KEY", "RESEND_WEBHOOK_SIGNING_SECRET", "ENCRYPTION_MASTER_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) if (env[key]) expect(text).not.toContain(env[key]);
  expect(text).not.toMatch(/ciphertext|credential_version|fingerprint/);
  const anon = await playwright.request.newContext({ baseURL: "http://localhost:3001" }); expect((await anon.get("/api/dashboard/setup")).status()).toBe(401); await anon.dispose();
  expect((await page.request.post("/api/dashboard/setup", { data: {} })).status()).toBe(405);
});

test("slow setup evidence never suspends the working dashboard", async ({ page }) => {
  await fixtures(page); let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/dashboard/setup", async route => { await gate; await route.fulfill({ json: deriveSetup(empty(), campaignCapabilities) }); });
  await page.goto("/"); await expect(page.getByRole("heading", { name: "Let's get things moving.", exact: true })).toBeVisible();
  await expect(page.getByText("Checking saved configuration. Your dashboard remains available.")).toBeVisible();
  await page.getByRole("button", { name: "Campaign History", exact: true }).click(); await expect(page.getByRole("heading", { name: "Campaign management", exact: true })).toBeVisible();
  release(); await page.getByRole("button", { name: "Overview", exact: true }).click(); await expect(page.locator(".setup-progress-row")).toContainText("0 of 7 complete");
});

test("acknowledged contact save invalidates setup; pending saves cannot complete a step", async ({ page }) => {
  const e = empty(); let reads = 0; let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  await fixtures(page, () => { reads++; return deriveSetup(e, campaignCapabilities); }); await mockAudienceData(page, overview);
  await page.route("**/api/dashboard/contacts", async route => {
    if (route.request().method() !== "POST") return route.fallback();
    const values = route.request().postDataJSON(); expect(values.existing_opt_in).toBe(true); expect(values.consent).toBeUndefined(); await gate;
    e.facts!.contacts = { total: 1, eligible: 1 }; await route.fulfill({ status: 201, json: { id: values.id } });
  });
  await loaded(page); await page.getByRole("button", { name: "Contacts", exact: true }).click();
  await page.locator('[data-guide="contact-add"]').click(); const drawer = page.getByRole("dialog", { name: "Add contact", exact: true });
  await drawer.getByLabel("Email address", { exact: true }).fill("guide-simulation@example.com");
  await expect(drawer.getByText(/Marketing permission/)).toHaveCount(0);
  await expect(drawer.getByLabel("Record a new consent decision")).toHaveCount(0);
  await drawer.getByRole("button", { name: "Save contact", exact: true }).click(); await expect(drawer.getByRole("button", { name: "Saving…", exact: true })).toBeVisible(); expect(reads).toBe(1);
  release(); await expect(drawer).toBeHidden(); await expect.poll(() => reads).toBe(2);
  const profile = page.getByRole("dialog"); await expect(profile).toBeVisible(); await page.keyboard.press("Escape"); await expect(profile).toBeHidden();
  await page.getByRole("button", { name: "Overview", exact: true }).click(); await expect(page.locator(".setup-step").filter({ hasText: "Build your audience" })).toContainText("Complete");
});

test("help stays available from every navigation destination", async ({ page }) => {
  await fixtures(page); await page.route("**/api/dashboard/suppressions?*", route => route.fulfill({ json: { rows: [], count: 0, page: 0, page_size: 25 } })); await loaded(page);
  for (const name of ["Overview", "Compose & Send", "Active Sending", "Campaign History", "Recipient Activity", "Contacts", "Settings"]) {
    await page.getByRole("button", { name, exact: true }).click(); await page.getByRole("button", { name: "Help", exact: true }).click();
    const help = page.getByRole("dialog", { name: "Help centre", exact: true }); await expect(help.locator(".help-context")).toContainText(name); await page.keyboard.press("Escape"); await expect(help).toBeHidden();
  }
  await page.getByRole("tab", { name: "Email setup", exact: true }).click(); await page.getByRole("button", { name: "Help", exact: true }).click(); await expect(page.locator(".help-context")).toContainText("Email Setup"); await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Overview", exact: true }).click(); await page.getByRole("button", { name: /Sending safeguards/ }).click(); await page.getByRole("button", { name: "Help", exact: true }).click(); await expect(page.locator(".help-context")).toContainText("Suppressions");
});

test("mobile notification cannot trap drawer Cancel beneath its informational text", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await fixtures(page); await loaded(page);
  await page.getByRole("button", { name: "Contacts", exact: true }).click(); await page.locator('[data-guide="contact-add"]').click();
  const drawer = page.getByRole("dialog", { name: "Add contact", exact: true }); await expect(drawer).toBeVisible();
  await drawer.getByRole("button", { name: "Cancel", exact: true }).click({ timeout: 2000 }); await expect(drawer).toBeHidden();
});
