import { expect, test, type Page } from "@playwright/test";
import { createHmac } from "node:crypto";
import { readFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

const configuration = parseEnv(readFileSync(resolve("apps/web/.env.local"), "utf8"));
const artifacts = resolve("artifacts/ui");
mkdirSync(artifacts, { recursive: true });

test.beforeEach(async ({ context }) => {
  const secret = configuration.ADMIN_SESSION_SECRET;
  if (!secret) throw new Error("Configure the local admin session secret before running browser checks.");
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600, nonce: "ui-verification" })).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  await context.addCookies([{ name: "marketing_os_admin", value: `${payload}.${signature}`, url: "http://localhost:3001", httpOnly: true, sameSite: "Lax" }]);
});

async function loaded(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Let's get things moving." })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

async function noOverflow(page: Page) {
  const widths = await page.evaluate(() => ({ actual: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth, outside: Array.from(document.querySelectorAll("body *")).filter(node => node.getBoundingClientRect().right > document.documentElement.clientWidth).slice(0,20).map(node => ({ tag: node.tagName, class: node.getAttribute("class"), right: node.getBoundingClientRect().right })) }));
  expect(widths.actual, JSON.stringify(widths)).toBeLessThanOrEqual(widths.viewport);
}

async function screenshot(page: Page, name: string) {
  await page.mouse.move(0, 0);
  await page.screenshot({ path: resolve(artifacts, name), fullPage: true, animations: "disabled" });
}

test("live dashboard loads and all navigation sections work", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const response = await page.request.get("/api/dashboard/overview");
  expect(response.ok()).toBeTruthy();
  const data = await response.json(); expect(Array.isArray(data.campaigns)).toBeTruthy(); expect(Array.isArray(data.contacts)).toBeTruthy();
  await loaded(page);
  await expect(page.locator(".os-error")).toHaveCount(0);
  await screenshot(page, "dashboard-light.png");
  const sections = [
    ["Compose & Send", "Campaign Start"], ["Active Sending", "Live sending status"],
    ["Campaign History", "Campaign management"], ["Recipient Activity", "Recipient activity"],
    ["Contacts", "Audience contacts"], ["Settings", "A little more you."],
  ];
  for (const [section, heading] of sections) {
    await page.getByRole("button", { name: section, exact: true }).click();
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    await noOverflow(page);
  }
  await page.getByRole("tab", { name: "Email setup" }).click();
  await expect(page.getByRole("heading", { name: "Your sending identity." })).toBeVisible();
  await page.getByRole("button", { name: "Compose & Send", exact: true }).click();
  await page.getByRole("button", { name: "Standard Editor", exact: true }).click();
  await page.getByLabel("Subject line").fill("A thoughtful hello");
  await page.getByLabel("Email content", { exact: true }).fill("Hello there. This is a preview only.");
  await page.getByRole("button", { name: "Preview email" }).first().click();
  await expect(page.getByRole("dialog", { name: "Email preview" })).toContainText("A thoughtful hello");
  await page.getByRole("button", { name: "Close preview" }).click();
  expect(errors).toEqual([]);
});

test("light, dark, preset and custom colors persist after refresh", async ({ page }) => {
  await loaded(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await screenshot(page, "settings-light.png");
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Lavender accent" }).click();
  await expect(page.getByRole("button", { name: "Lavender accent" })).toHaveAttribute("aria-pressed", "true");
  await screenshot(page, "settings-dark.png");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("heading", { name: "Let's get things moving." })).toBeVisible();
  await screenshot(page, "dashboard-dark.png");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Custom accent color").fill("#acd9ef");
  await expect(page.locator(".custom-color code")).toHaveText("#ACD9EF");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("marketing-os-appearance")!).accent)).toBe("#acd9ef");
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent-color").trim())).toBe("#acd9ef");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  for (const theme of ["Light", "Dark"]) {
    await page.getByRole("button", { name: theme, exact: true }).click();
    for (const color of ["#000000", "#ffffff", "#ff0000"]) {
      await page.getByLabel("Custom accent color").fill(color);
      const contrast = await page.locator(".preview-tiles .accent").evaluate(element => {
        const context = document.createElement("canvas").getContext("2d")!;
        const luminance = (color: string) => {
          context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1);
          const [red, green, blue] = Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3).map(channel => { const value = channel / 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4; });
          return red * .2126 + green * .7152 + blue * .0722;
        };
        const styles = getComputedStyle(element); const foreground = luminance(styles.color); const background = luminance(styles.backgroundColor);
        return (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05);
      });
      expect(contrast).toBeGreaterThanOrEqual(4.5);
    }
  }
});

test("mobile sections fit the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await loaded(page); await noOverflow(page);
  await screenshot(page, "dashboard-mobile.png");
  for (const section of ["Compose & Send", "Active Sending", "Campaign History", "Recipient Activity", "Contacts", "Settings"]) {
    await page.getByRole("button", { name: section, exact: true }).click(); await noOverflow(page);
  }
  await screenshot(page, "settings-mobile.png");
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await screenshot(page, "dashboard-mobile-dark.png");
});

test("failed data requests show retry and keep navigation usable", async ({ page }) => {
  await page.route("**/api/dashboard/overview*", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Temporary connection issue" }) }));
  await page.goto("/"); await expect(page.locator(".os-error")).toContainText("Temporary connection issue");
  await expect(page.getByRole("status", { name: "Loading dashboard" })).toHaveCount(0);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "A little more you." })).toBeVisible();
  await page.unroute("**/api/dashboard/overview*");
  await page.route("**/api/dashboard/overview*", route => route.fulfill({ json: { campaigns: [], contacts: [], settings: null, events: [], totals: {} } }));
  await page.locator(".os-error").getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.locator(".os-error")).toHaveCount(0);
});

test("calendar navigation uses actual dates and the date filter clears", async ({ page }) => {
  await loaded(page);
  const heading = page.locator(".calendar-heading h3"); const month = await heading.textContent();
  await page.getByRole("button", { name: "Next month" }).click(); await expect(heading).not.toHaveText(month!);
  await page.getByRole("button", { name: "Previous month" }).click(); await expect(heading).toHaveText(month!);
  await page.locator(".calendar-days button:not(.outside)").first().click();
  await expect(page.getByRole("heading", { name: "Campaigns on this day" })).toBeVisible();
  await page.getByRole("button", { name: "Clear filter" }).click();
  await expect(page.getByRole("heading", { name: "Recent campaigns" })).toBeVisible();
});
