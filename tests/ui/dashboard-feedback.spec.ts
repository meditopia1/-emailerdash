import { expect, test, type Page } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync, mkdirSync } from "node:fs";
import { parseEnv } from "node:util";
import { resolve } from "node:path";
import type { Overview, Campaign } from "../../apps/web/app/dashboard/types";
import { contactPage, mockAudienceData } from "./audience-fixtures";

const env = parseEnv(readFileSync(resolve("apps/web/.env.local"), "utf8"));
const artifacts = resolve("artifacts/ui"); mkdirSync(artifacts, { recursive: true });
test.beforeEach(async ({ context, page }) => {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600, nonce: "dashboard-feedback" })).toString("base64url");
  const signature = createHmac("sha256", env.ADMIN_SESSION_SECRET).update(payload).digest("base64url");
  await context.addCookies([{ name: "marketing_os_admin", value: `${payload}.${signature}`, url: "http://localhost:3001", httpOnly: true, sameSite: "Lax" }]);
  await mockAudienceData(page, empty());
});
const empty = (): Overview => ({ campaigns: [], contacts: [], events: [], settings: null, totals: { contacts: 0, campaigns: 0, suppressed: 0, delivered: 0, opened_delivered: 0, sending_campaigns: 0 }, sending: { configured: false, from_email: null, status: "Resend not configured" } });
const toasts = (page: Page) => page.locator("[data-sonner-toast]");
const toastTitle = (page: Page, value: string) => toasts(page).locator("[data-title]").filter({ hasText: value });
async function mockOverview(page: Page, data: Overview) { await page.route("**/api/dashboard/overview*", route => route.fulfill({ json: data })); await mockAudienceData(page, data); }
async function loaded(page: Page) { await page.goto("/"); await expect(page.getByRole("heading", { name: "Let's get things moving.", exact: true })).toBeVisible(); }
async function fit(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect(await page.locator(".section-heading h2, .section-heading p, .header-greeting h1").evaluateAll(nodes => nodes.every(node => node.scrollWidth <= node.clientWidth + 1))).toBe(true);
}

test("four pages use clear empty copy and one successful page-load toast", async ({ page }) => {
  test.setTimeout(90000);
  await mockOverview(page, empty()); await loaded(page);
  for (const [nav, heading, section, noRecords] of [
    ["Active Sending", "Sending queue.", "Live sending status", "Nothing sending right now."],
    ["Campaign History", "Your campaigns.", "Campaign management", "No campaigns created yet."],
    ["Recipient Activity", "Email activity.", "Recipient activity", "No email activity yet."],
    ["Contacts", "Your contacts.", "Audience contacts", "Your audience is empty."],
  ]) {
    await page.getByRole("button", { name: nav, exact: true }).click();
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: section, exact: false })).toBeVisible();
    await expect(page.getByRole("heading", { name: noRecords, exact: true })).toBeVisible();
    if (["Active Sending", "Campaign History"].includes(nav)) await expect(page.getByRole("button", { name: "Create campaign", exact: true })).toBeVisible();
    await expect(toastTitle(page, "Data loaded")).toBeVisible(); await expect(toasts(page)).toHaveCount(1);
    await page.mouse.move(0, 0); await fit(page);
    await page.screenshot({ path: resolve(artifacts, `feedback-${nav.toLowerCase().replaceAll(" ", "-")}-desktop.png`), fullPage: true, animations: "disabled" });
    await page.setViewportSize({ width: 390, height: 844 }); await fit(page);
    await page.getByRole("button", { name: "Refresh dashboard", exact: true }).click();
    await expect(toastTitle(page, "Data loaded")).toBeVisible();
    await expect(page.locator("[data-sonner-toaster]")).toHaveAttribute("data-x-position", "center");
    await page.screenshot({ path: resolve(artifacts, `feedback-${nav.toLowerCase().replaceAll(" ", "-")}-mobile.png`), fullPage: true, animations: "disabled" });
    await page.setViewportSize({ width: 1440, height: 1060 });
  }
});

test("manual loading toast is replaced by confirmed success, not duplicated", async ({ page }) => {
  let release!: () => void; let delayed = false;
  await page.route("**/api/dashboard/overview*", async route => { if (delayed) await new Promise<void>(resolve => { release = resolve; }); await route.fulfill({ json: empty() }); });
  await loaded(page); delayed = true;
  await page.getByRole("button", { name: "Refresh dashboard", exact: true }).click();
  await expect(toastTitle(page, "Refreshing data")).toBeVisible(); await expect(toasts(page)).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Refresh dashboard", exact: true })).toBeDisabled();
  release(); await expect(toastTitle(page, "Data loaded")).toBeVisible(); await expect(toasts(page)).toHaveCount(1);
});

test("leaving Contacts does not dismiss the next page's notification", async ({ page }) => {
  await mockOverview(page, empty()); await loaded(page);
  for (const section of ["Contacts", "Campaign History", "Contacts", "Active Sending"]) {
    await page.getByRole("complementary", { name: "Main navigation" }).getByRole("button", { name: section, exact: true }).click();
    await expect(toastTitle(page, "Data loaded")).toBeVisible();
    await page.waitForTimeout(450);
    await expect(toastTitle(page, "Data loaded")).toBeVisible();
    await expect(toasts(page)).toHaveCount(1);
    await expect(toasts(page).getByRole("button", { name: "Retry", exact: true })).toHaveCount(0);
  }
});

test("failed initial requests never become empty states; toast Retry reconnects", async ({ page }) => {
  test.setTimeout(90000);
  let failing = true;
  await page.route("**/api/dashboard/contacts?*", route => route.fulfill({ status: failing ? 503 : 200, json: failing ? { error: "Temporary database outage" } : contactPage(empty()) }));
  await page.route("**/api/dashboard/overview*", route => failing ? route.fulfill({ status: 503, json: { error: "Temporary database outage" } }) : route.fulfill({ json: empty() }));
  await page.goto("/"); await expect(toastTitle(page, "Couldn't load data")).toBeVisible();
  for (const nav of ["Campaign History", "Active Sending", "Recipient Activity", "Contacts"]) {
    await page.getByRole("button", { name: nav, exact: true }).click();
    await expect(page.locator(".os-error,.audience-error")).toContainText("Temporary database outage");
    await expect(page.getByText("No campaigns created yet.", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Nothing sending right now.", { exact: true })).toHaveCount(0);
    await expect(page.getByText("No email activity yet.", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Your audience is empty.", { exact: true })).toHaveCount(0);
  }
  await expect(toasts(page).locator("[data-description]")).toContainText("contacts");
  failing = false;
  await toasts(page).getByRole("button", { name: "Retry", exact: true }).click();
  await expect(toastTitle(page, "Connection restored")).toBeVisible(); await expect(page.locator(".os-error")).toHaveCount(0);
  await expect(page.getByText("Your audience is empty.", { exact: true })).toBeVisible();
});

test("cached records remain visible but are explicitly outdated after refresh fails", async ({ page }) => {
  const data = empty(); data.campaigns = [{ id: randomUUID(), name: "Previously loaded campaign", status: "draft", total_count: 0, accepted_count: 0, delivered_count: 0, opened_count: 0, clicked_count: 0, failed_count: 0, blocked_count: 0, created_at: new Date().toISOString() }];
  let failing = false; await page.route("**/api/dashboard/overview*", route => route.fulfill({ status: failing ? 503 : 200, json: failing ? { error: "Storage unavailable" } : data }));
  await loaded(page); await page.getByRole("button", { name: "Campaign History", exact: true }).click();
  await expect(page.getByRole("button", { name: "Previously loaded campaign", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh dashboard", exact: true })).toBeEnabled(); failing = true;
  await page.getByRole("button", { name: "Refresh dashboard", exact: true }).click();
  await expect(page.locator(".os-error")).toContainText("may be outdated");
  await expect(page.getByRole("button", { name: "Previously loaded campaign", exact: true })).toBeVisible();
  await expect(page.getByText("No campaigns created yet.", { exact: true })).toHaveCount(0);
  await page.mouse.move(0, 0); await page.screenshot({ path: resolve(artifacts, "feedback-stale-records.png"), fullPage: true, animations: "disabled" });
});

test("polling deduplicates errors, does not spam success, and announces recovery once", async ({ page }) => {
  await page.clock.install(); let failing = false; let requests = 0;
  await page.route("**/api/dashboard/overview*", route => { requests++; return route.fulfill({ status: failing ? 503 : 200, json: failing ? { error: "Repeated database outage" } : empty() }); });
  await loaded(page); await page.clock.runFor(500); await expect(toastTitle(page, "Data loaded")).toBeVisible();
  await page.clock.fastForward(5000); await page.clock.runFor(500); await expect(toasts(page)).toHaveCount(0);
  failing = true; await page.clock.fastForward(16000); await expect(toastTitle(page, "Couldn't load data")).toBeVisible();
  await page.clock.fastForward(7000); await page.clock.runFor(500); await expect(toasts(page)).toHaveCount(0);
  await page.clock.fastForward(16000); await expect.poll(() => requests).toBeGreaterThanOrEqual(3); await expect(toasts(page)).toHaveCount(0);
  failing = false; await page.clock.fastForward(16000); await expect(toastTitle(page, "Connection restored")).toBeVisible();
  await page.clock.fastForward(16000); await page.clock.runFor(500); await expect(toasts(page)).toHaveCount(0);
});

test("active records use actual recipient counts, stored engagement and eligibility", async ({ page }) => {
  const data = empty(); const now = new Date().toISOString();
  const campaign: Campaign = { id: randomUUID(), name: "Operational campaign", status: "sending", total_count: 10, recipient_count: 10, queued_count: 4, processed_count: 6, accepted_count: 5, failed_count: 1, blocked_count: 0, delivered_count: 3, opened_count: 2, clicked_count: 1, created_at: now, started_at: now, completed_at: null };
  data.campaigns = [campaign]; data.contacts = [{ id: randomUUID(), name: "Example Contact", email: "recipient@example.com", consent_source: "Newsletter signup", consented_at: now, imported_at: now, eligible: false, reason: "Suppressed: bounced" }]; data.totals.contacts = 1;
  data.events = [{ id: randomUUID(), campaign_name: campaign.name, campaign_id: campaign.id, email: "recipient@example.com", event_type: "clicked", event_at: now, clicked_url: "https://example.com/product" }];
  await mockOverview(page, data); await loaded(page);
  const capture = async (name: string) => {
    await page.mouse.move(0, 0); await fit(page);
    await page.screenshot({ path: resolve(artifacts, `feedback-populated-${name}-desktop.png`), fullPage: true, animations: "disabled" });
    await page.setViewportSize({ width: 390, height: 844 }); await fit(page);
    await page.screenshot({ path: resolve(artifacts, `feedback-populated-${name}-mobile.png`), fullPage: true, animations: "disabled" });
    await page.setViewportSize({ width: 1440, height: 1060 });
  };
  await page.getByRole("button", { name: "Active Sending", exact: true }).click();
  await expect(page.getByRole("cell", { name: "60%", exact: true })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Messages processed", exact: true })).toBeVisible();
  await capture("sending");
  await page.getByRole("button", { name: "Campaign History", exact: true }).click();
  for (const value of ["Date sent", "Delivered", "Opened", "Clicked"]) await expect(page.getByRole("columnheader", { name: value, exact: true })).toBeVisible();
  await capture("campaigns");
  await page.getByRole("button", { name: "Recipient Activity", exact: true }).click();
  await expect(page.getByRole("link", { name: "https://example.com/product", exact: true })).toHaveAttribute("rel", "noreferrer");
  await expect(page.getByRole("cell", { name: "Operational campaign", exact: true })).toBeVisible();
  await capture("activity");
  await page.getByRole("button", { name: "Contacts", exact: true }).click();
  await expect(page.getByRole("cell", { name: "granted", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Suppressed", exact: true })).toBeVisible();
  await capture("contacts");
});

for (const outcome of ["success", "rejected", "unknown", "unconfirmed"]) {
  test(`contact ${outcome} feedback waits for server confirmation`, async ({ page }) => {
    await mockOverview(page, empty()); let release!: () => void;
    await page.route("**/api/dashboard/contacts", async route => { await new Promise<void>(resolve => { release = resolve; }); return outcome === "unknown" ? route.abort("failed") : route.fulfill({ status: outcome === "success" ? 201 : outcome === "unconfirmed" ? 503 : 400, json: outcome === "success" ? { id: randomUUID() } : { error: outcome === "unconfirmed" ? "Storage could not confirm this request" : "Contact rejected" } }); });
    await loaded(page); await page.getByRole("button", { name: "Contacts", exact: true }).click();
    await page.getByRole("button", { name: "Add contact", exact: true }).first().click();
    await page.getByLabel("Email address", { exact: true }).fill("new@example.com");
    await page.getByRole("button", { name: "Save contact", exact: true }).click();
    await expect(toastTitle(page, "Saving changes")).toBeVisible(); await expect(toastTitle(page, "Changes saved")).toHaveCount(0);
    release();
    const title = outcome === "success" ? "Changes saved" : outcome === "rejected" ? "Couldn't save changes" : "Save not confirmed";
    await expect(toastTitle(page, title)).toBeVisible();
    const saveToast = toasts(page).filter({ hasText: title });
    if (outcome !== "success") await expect(page.getByLabel("Email address", { exact: true })).toHaveValue("new@example.com");
    if (["unknown", "unconfirmed"].includes(outcome)) await expect(saveToast).not.toContainText("weren't saved");
    await saveToast.getByRole("button", { name: "Dismiss notification", exact: true }).click();
  });
}

test("reduced-motion and dark-theme notifications remain readable", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" }); await mockOverview(page, empty()); await loaded(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click(); await page.getByRole("button", { name: "Dark", exact: true }).click();
  await page.getByRole("button", { name: "Campaign History", exact: true }).click(); await expect(toastTitle(page, "Data loaded")).toBeVisible();
  expect(await toasts(page).evaluate(node => getComputedStyle(node).transitionDuration)).toBe("0s");
  expect(await toasts(page).locator("[data-description]").evaluate(node => getComputedStyle(node).color)).toBe("rgb(160, 170, 165)");
  await page.mouse.move(0, 0); await page.screenshot({ path: resolve(artifacts, "feedback-dark-reduced-motion.png"), fullPage: true, animations: "disabled" });
});

test("live data and authorization checks use real storage without mutations", async ({ page, playwright }) => {
  const response = await page.request.get("/api/dashboard/overview?view=contacts"); expect(response.status(), await response.text()).toBe(200);
  const result = await response.json(); expect(result.campaigns.length).toBeLessThanOrEqual(20); expect(result.contacts.length).toBeLessThanOrEqual(100);
  expect(result.contacts.every((row: { eligible: unknown }) => typeof row.eligible === "boolean")).toBe(true);
  expect(JSON.stringify(result)).not.toContain("payload"); expect(JSON.stringify(result)).not.toContain("ciphertext");
  const sending = await page.request.get("/api/dashboard/overview?view=sending"); expect(sending.status(), await sending.text()).toBe(200);
  expect((await sending.json()).campaigns.every((row: { status: string }) => ["queued", "sending"].includes(row.status))).toBe(true);
  const anon = await playwright.request.newContext({ baseURL: "http://localhost:3001" });
  expect((await anon.get("/api/dashboard/overview")).status()).toBe(401); await anon.dispose();
});
