import { expect, test, type Page } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import type { Campaign, Overview } from "../../apps/web/app/dashboard/types";

const env = parseEnv(readFileSync(resolve("apps/web/.env.local"), "utf8"));
const artifacts = resolve("artifacts/ui"); mkdirSync(artifacts, { recursive: true });
test.beforeEach(async ({ context }) => {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600, nonce: "overview-copy" })).toString("base64url");
  const signature = createHmac("sha256", env.ADMIN_SESSION_SECRET).update(payload).digest("base64url");
  await context.addCookies([{ name: "marketing_os_admin", value: `${payload}.${signature}`, url: "http://localhost:3001", httpOnly: true, sameSite: "Lax" }]);
});
const empty = (): Overview => ({ campaigns: [], contacts: [], settings: null, events: [], totals: { campaigns: 0, contacts: 0, suppressed: 0, accepted: 0, delivered: 0, opened_delivered: 0, sending_campaigns: 0 }, sending: { configured: false, from_email: null, status: "Resend not configured" } });
function campaign(status: string): Campaign {
  const today = new Date();
  return { id: randomUUID(), name: `${status} campaign`, status, total_count: 100, accepted_count: 100, delivered_count: 40, opened_count: 20, clicked_count: 5, failed_count: status === "failed" ? 3 : 0, blocked_count: 0, created_at: new Date(today.getFullYear(), today.getMonth(), 2, 12).toISOString(), started_at: new Date(today.getFullYear(), today.getMonth(), 4, 12).toISOString(), completed_at: status === "completed" ? new Date(today.getFullYear(), today.getMonth(), 5, 12).toISOString() : null };
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const clipped = await page.locator(".section-title h2, .tile-bottom strong, .tile-bottom small, .quick-card strong, .quick-card small").evaluateAll(nodes => nodes.filter(node => node.scrollWidth > node.clientWidth + 1).map(node => node.textContent));
  expect(clipped).toEqual([]);
}
async function open(page: Page, data: Overview) {
  await page.route("**/api/dashboard/overview*", route => route.fulfill({ json: data }));
  await page.goto("/"); await expect(page.getByRole("heading", { name: "Let's get things moving.", exact: true })).toBeVisible();
}

test("first-time homepage copy, real destinations and responsive screenshots", async ({ page }) => {
  await open(page, empty());
  await expect(page.getByText("YOUR EMAIL COMMAND CENTRE", { exact: true })).toBeVisible();
  await expect(page.getByText("Everything you need to create, send and track your campaigns.", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No campaigns yet.", exact: true })).toBeVisible();
  await expect(page.locator(".quiet-note")).toContainText("Set up email sending");
  await expect(page.locator(".progress-tile").filter({ hasText: "Open rate" }).locator("strong")).toHaveText("—");
  await expect(page.locator(".quick-links")).toContainText("Connect Resend and configure your sending domain.");
  await expect(page.locator(".overview-layout")).not.toContainText("scheduled");
  await noOverflow(page); await page.screenshot({ path: resolve(artifacts, "overview-copy-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 }); await noOverflow(page);
  await page.screenshot({ path: resolve(artifacts, "overview-copy-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1060 });
  await page.getByRole("button", { name: "Create campaign", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Campaign Start", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Visual Builder", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page.getByRole("button", { name: "View contacts", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Audience contacts", exact: false })).toBeVisible();
});

for (const state of ["no-recipients", "sending", "completed", "failed"]) {
  test(`operational ${state} state uses actual supplied metrics`, async ({ page }) => {
    const data = empty(); data.sending = { configured: true, from_email: "support@example.com", status: "Sender saved · test required" };
    if (state !== "no-recipients") { data.totals.contacts = 100; data.totals.campaigns = 1; data.campaigns = [campaign(state)]; }
    if (state === "sending") data.totals.sending_campaigns = 1;
    if (state === "completed") Object.assign(data.totals, { accepted: 100, delivered: 40, opened: 30, opened_delivered: 20 });
    await open(page, data);
    await expect(page.locator(".quick-links")).toContainText("support@example.com");
    await expect(page.locator(".quick-links")).toContainText("Sender saved · test required");
    const note = state === "no-recipients" ? "Add your first recipients" : state === "sending" ? "1 campaign is sending" : state === "failed" ? "needs attention" : "Review your campaign results";
    await expect(page.locator(".quiet-note")).toContainText(note);
    if (state === "completed") {
      await expect(page.locator(".progress-tile").filter({ hasText: "Delivered" }).locator("strong")).toHaveText("40");
      await expect(page.locator(".progress-tile").filter({ hasText: "Open rate" }).locator("strong")).toHaveText("50%");
      const day = page.locator(".calendar-days button").filter({ hasText: /^4$/ }).first();
      await expect(day).toHaveAttribute("aria-label", /sending started/); await day.click();
      await expect(page.locator(".recent-campaigns")).toContainText("completed campaign");
      await page.getByRole("button", { name: "Clear filter" }).click();
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page.getByRole("button", { name: "Dark", exact: true }).click();
      await page.getByRole("button", { name: "Overview", exact: true }).click();
      await noOverflow(page); await page.mouse.move(0, 0); await page.screenshot({ path: resolve(artifacts, "overview-copy-results-dark.png"), fullPage: true });
    }
    await page.setViewportSize({ width: 390, height: 844 }); await noOverflow(page);
  });
}

test("safeguards opens the approved read-only, paginated suppression list", async ({ page }) => {
  const data = empty(); data.totals.suppressed = 2;
  const requests: string[] = [];
  await page.route("**/api/dashboard/suppressions?*", route => {
    requests.push(route.request().method()); const url = new URL(route.request().url());
    return route.fulfill({ json: { rows: [{ id: url.searchParams.get("cursor") ? "second" : "first", normalized_email: url.searchParams.get("cursor") ? "second@example.com" : "blocked@example.com", reason: "bounced", source: "resend_webhook", created_at: new Date().toISOString() }], next_cursor: url.searchParams.get("cursor") ? null : "mock-next-page" } });
  });
  await open(page, data);
  await page.getByRole("button", { name: /Sending safeguards/ }).click();
  await expect(page.getByRole("heading", { name: "Suppressed addresses", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "blocked@example.com" })).toBeVisible();
  await page.getByRole("button", { name: "Load more addresses" }).click();
  await expect(page.getByRole("cell", { name: "second@example.com" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "blocked@example.com" })).toBeVisible();
  expect(requests).toEqual(["GET", "GET"]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("live summary and suppression reads remain private and bounded", async ({ page, playwright }) => {
  const request = page.request;
  const overview = await request.get("/api/dashboard/overview"); expect(overview.status()).toBe(200);
  const body = await overview.text(); const data = JSON.parse(body);
  expect(data.campaigns.length).toBeLessThanOrEqual(20); expect(typeof data.totals.sending_campaigns).toBe("number");
  expect(typeof data.sending.configured).toBe("boolean");
  expect(body).not.toContain("ciphertext"); expect(body).not.toContain("credential_version");
  for (const field of ["RESEND_API_KEY", "SUPABASE_SERVICE_ROLE_KEY", "ENCRYPTION_MASTER_KEY"]) if (env[field]) expect(body).not.toContain(env[field]);
  const response = await request.get("/api/dashboard/suppressions"); expect(response.status()).toBe(200);
  expect((await response.json()).rows.length).toBeLessThanOrEqual(50);
  expect((await request.get("/api/dashboard/suppressions?cursor=invalid")).status()).toBe(400);
  const anon = await playwright.request.newContext({ baseURL: "http://localhost:3001" });
  expect((await anon.get("/api/dashboard/suppressions")).status()).toBe(401); await anon.dispose();
});
