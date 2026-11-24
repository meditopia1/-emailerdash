import { expect, test } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { encryptSecret } from "../../apps/web/lib/crypto";
import { parseAudienceCsv, defaultLayout } from "../../apps/web/app/campaign-builder/model";

const configuration = { ...parseEnv(readFileSync(resolve(".env"), "utf8")), ...parseEnv(readFileSync(resolve("apps/web/.env.local"), "utf8")), ...process.env };
const requireWorker = createRequire(resolve("apps/worker/package.json"));
const postgres = requireWorker("postgres");
const sql = postgres(configuration.DATABASE_URL, { max: 1, connect_timeout: 15, onnotice: () => {} });
const run = randomUUID(); const prefix = `BUILDER SIMULATION ${run}`;
const goodId = randomUUID(); const blockedId = randomUUID(); const noConsentId = randomUUID(); const monitorId = randomUUID(); const recipientId = randomUUID();
const goodEmail = `builder-${run}@example.com`; const blockedEmail = `blocked-${run}@example.com`;
const artifacts = resolve("artifacts/ui"); mkdirSync(artifacts, { recursive: true });
let sender: { sender_name: string; from_email: string; reply_to: string | null };
let createdSettings = false;

test.beforeAll(async () => {
  test.setTimeout(90000);
  await sql.begin(async fixture => {
    await fixture`set local statement_timeout = '15s'`;
  const settings = await fixture`select sender_name, from_email, reply_to from public.mail_settings where id = true`;
  if (settings.length) {
    const identities = await fixture`select sender_name,from_email,reply_to from public.mail_sender_identities order by is_default desc,created_at limit 1`;
    sender = identities[0] ?? settings[0];
  }
  else {
    sender = { sender_name: prefix, from_email: "onboarding@resend.dev", reply_to: null };
    const encrypted = encryptSecret("simulation-only-no-sending", configuration.ENCRYPTION_MASTER_KEY || run);
    await fixture`insert into public.mail_settings (id,sender_name,from_email,company_name,physical_address,resend_api_key_ciphertext,webhook_secret_ciphertext) values (true,${prefix},'onboarding@resend.dev',${prefix},'Simulation address',${encrypted},${encrypted})`;
    createdSettings = true;
  }
  await fixture`insert into public.mail_contacts(id,email,name,consent_source,consented_at,consent_status) values (${goodId},${goodEmail},'Builder Eligible','automated simulation',now(),'granted'),(${blockedId},${blockedEmail},'Builder Suppressed','automated simulation',now(),'granted')`;
  await fixture`insert into public.mail_contacts(id,email,name,consent_source,consented_at) values (${noConsentId},${'future-' + goodEmail},'Future consent simulation','automated simulation',now() + interval '1 day')`;
  await fixture`insert into public.mail_suppressions(normalized_email,reason,source) values (${blockedEmail},'manual','automated builder simulation')`;
  await fixture`insert into public.mail_campaigns(id,name,sender_name,from_email,subject,content_text,status,total_count,accepted_count,delivered_count,opened_count,failed_count) values (${monitorId},${prefix + ' monitor'},${sender.sender_name},${sender.from_email},'Monitor simulation','Simulation content','completed',2,1,1,1,1)`;
  await fixture`insert into public.mail_recipients(id,campaign_id,contact_id,email,name,status,provider_message_id,accepted_at,delivered_at,latest_event_at) values (${recipientId},${monitorId},${goodId},${goodEmail},'Builder Eligible','opened',${'simulation-' + run},now(),now(),now())`;
  await fixture`insert into public.mail_events(provider_event_id,campaign_id,recipient_id,email,event_type,event_at) values (${run},${monitorId},${recipientId},${goodEmail},'opened',now())`;
  });
});

test.afterAll(async () => {
  try {
    await sql`delete from public.mail_events where provider_event_id = ${run}`;
    await sql`delete from public.mail_campaigns where name like ${prefix + '%'}`;
    await sql`delete from public.mail_contacts where id in (${goodId},${blockedId},${noConsentId})`;
    await sql`delete from public.mail_suppressions where normalized_email = ${blockedEmail}`;
    if (createdSettings) await sql`delete from public.mail_settings where id = true and sender_name = ${prefix} and company_name = ${prefix}`;
    const remaining = await sql`select count(*)::integer as total from public.mail_campaigns where name like ${prefix + '%'}`;
    expect(remaining[0].total).toBe(0);
  } finally { await sql.end(); }
});

test.beforeEach(async ({ context }) => {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600, nonce: "builder-tests" })).toString("base64url");
  const signature = createHmac("sha256", configuration.ADMIN_SESSION_SECRET!).update(payload).digest("base64url");
  await context.addCookies([{ name: "marketing_os_admin", value: `${payload}.${signature}`, url: "http://localhost:3001", httpOnly: true, sameSite: "Lax" }]);
});

test("campaign APIs preserve identity, reject stale writes and keep layouts independent", async ({ context, playwright }) => {
  test.setTimeout(90000);
  const request = context.request;
  const anonymous = await playwright.request.newContext({ baseURL: "http://localhost:3001" });
  expect((await anonymous.get(`/api/dashboard/campaigns/${monitorId}`)).status()).toBe(401); await anonymous.dispose();
  expect((await request.get("/api/dashboard/campaigns/not-a-uuid")).status()).toBe(400);
  const draft = { name: prefix + " API", subject: "A real draft", content_text: "Hello {{name}}", sender_name: sender.sender_name, from_email: sender.from_email, reply_to: sender.reply_to ?? "", audience_contact_ids: [goodId, goodId, blockedId] };
  expect((await request.post("/api/dashboard/campaigns", { data: { ...draft, status: "queued" } })).status()).toBe(400);
  const created = await request.post("/api/dashboard/campaigns", { data: draft }); expect(created.status()).toBe(201);
  const campaign = await created.json(); expect(campaign.audience_contact_ids).toHaveLength(2);
  const detail = await (await request.get(`/api/dashboard/campaigns/${campaign.id}`)).json();
  expect(detail.audience).toMatchObject({ selected: 2, eligible: 1, excluded: 1 }); expect(detail.capabilities.send).toBe(true);
  const checked = await (await request.post("/api/dashboard/contacts", { data: { action: "resolve", contact_ids: [goodId, blockedId, noConsentId] } })).json();
  expect(checked).toMatchObject({ selected: 3, eligible: 1, excluded: 2 });
  const queue = await sql`select count(*)::integer as count from public.mail_recipients where campaign_id = ${campaign.id}`; expect(queue[0].count).toBe(0);
  const update = { kind: "draft", expected_revision: campaign.revision, draft: { ...draft, name: prefix + " API updated" } };
  const updated = await request.patch(`/api/dashboard/campaigns/${campaign.id}`, { data: update }); expect(updated.status()).toBe(200); const saved = await updated.json(); expect(saved.revision).toBe(1);
  expect((await request.patch(`/api/dashboard/campaigns/${campaign.id}`, { data: update })).status()).toBe(409);
  const layout = { ...defaultLayout, positions: { ...defaultLayout.positions, start: { x: 94, y: 137 } } };
  const savedLayout = await request.patch(`/api/dashboard/campaigns/${campaign.id}`, { data: { kind: "layout", expected_revision: 0, layout } }); expect(savedLayout.status()).toBe(200);
  expect((await request.patch(`/api/dashboard/campaigns/${campaign.id}`, { data: { kind: "layout", expected_revision: 0, layout } })).status()).toBe(409);
  expect((await request.patch(`/api/dashboard/campaigns/${campaign.id}`, { data: { kind: "layout", expected_revision: 1, layout: { ...layout, edges: [] } } })).status()).toBe(400);
  expect((await request.patch(`/api/dashboard/campaigns/${campaign.id}`, { headers: { origin: "https://untrusted.example" }, data: update })).status()).toBe(403);
  const final = await (await request.get(`/api/dashboard/campaigns/${campaign.id}`)).json(); expect(final.campaign.name).toBe(prefix + " API updated"); expect(final.campaign.revision).toBe(1); expect(final.campaign.workflow_layout.positions.start).toEqual({ x: 94, y: 137 });
  expect((await request.patch(`/api/dashboard/campaigns/${monitorId}`, { data: { ...update, expected_revision: 0 } })).status()).toBe(409);
  const protectedTables = await sql`select relname,relrowsecurity,relforcerowsecurity from pg_class join pg_namespace n on n.oid=relnamespace where n.nspname='public' and relname in ('mail_campaigns','mail_contacts','mail_recipients','mail_events')`;
  expect(protectedTables.every((table: { relrowsecurity: boolean; relforcerowsecurity: boolean }) => table.relrowsecurity && table.relforcerowsecurity)).toBeTruthy();
});

test("visual and standard modes share fields, previews and saved layout", async ({ page }) => {
  test.setTimeout(90000);
  page.on("dialog", dialog => dialog.accept());
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto("/"); await expect(page.getByRole("heading", { name: "Let's get things moving." })).toBeVisible();
  await page.getByRole("button", { name: "Compose & Send", exact: true }).click();
  await expect(page.locator(".react-flow__node")).toHaveCount(4); await expect(page.locator(".react-flow__edge")).toHaveCount(3);
  await page.getByLabel("Campaign name", { exact: true }).fill(prefix + " visual");
  await page.getByRole("button", { name: "Standard Editor", exact: true }).click();
  await expect(page.getByLabel("Campaign name", { exact: true })).toHaveValue(prefix + " visual");
  await page.getByLabel("Subject line").fill("A thoughtful hello"); await page.getByLabel("Email content", { exact: true }).fill("Hello {{name}}, from {{email}}.");
  await page.getByLabel("Search audience contacts").fill(goodEmail);
  await page.getByRole("checkbox", { name: `Builder Eligible ${goodEmail}`, exact: true }).check();
  await page.getByRole("button", { name: "Visual Builder", exact: true }).click();
  await page.locator('[data-id="email"]').click();
  await expect(page.getByLabel("Subject line")).toHaveValue("A thoughtful hello"); await expect(page.getByLabel("Email content", { exact: true })).toHaveValue("Hello {{name}}, from {{email}}.");
  await page.getByRole("button", { name: "Preview email", exact: true }).first().click();
  await expect(page.getByRole("dialog", { name: "Email preview" })).toContainText("Hello Builder Eligible"); await page.getByRole("button", { name: "Close preview" }).click();
  await expect(page.getByRole("button", { name: "Send test email", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "HTML", exact: true }).click(); await page.getByLabel("Email content", { exact: true }).fill('<p>Hello {{name}}</p><script>window.__builderInjected=true</script>');
  await page.getByRole("button", { name: "Preview email", exact: true }).first().click();
  await expect(page.frameLocator('iframe[title="Personalized HTML email"]').getByText("Hello Builder Eligible")).toBeVisible(); expect(await page.evaluate(() => (window as unknown as { __builderInjected?: boolean }).__builderInjected)).toBeUndefined();
  await page.getByRole("button", { name: "Close preview" }).click(); await page.getByRole("button", { name: "Plain text", exact: true }).click();
  await page.getByRole("button", { name: "Save draft", exact: true }).click(); await expect(page.getByRole("status").filter({ hasText: "Draft saved" })).toBeVisible();
  const start = page.locator('[data-id="start"] .workflow-node-heading'); const box = await start.boundingBox(); expect(box).toBeTruthy();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2); await page.mouse.down(); await page.mouse.move(box!.x + box!.width / 2 + 45, box!.y + box!.height / 2 + 70, { steps: 15 }); await page.mouse.up();
  const savedResponse = page.waitForResponse(response => response.url().includes("/api/dashboard/campaigns/") && response.request().method() === "PATCH" && response.request().postDataJSON()?.kind === "layout");
  await page.getByRole("button", { name: "Save layout", exact: true }).click(); expect((await savedResponse).ok()).toBeTruthy(); const savedLayout = await (await savedResponse).json(); expect(savedLayout.workflow_layout.positions.start).not.toEqual(defaultLayout.positions.start);
  await page.getByRole("button", { name: "Fit workflow into view" }).click(); await page.mouse.move(0, 0); await page.screenshot({ path: resolve(artifacts, "campaign-builder-dark.png"), fullPage: true });
  await page.getByRole("button", { name: "Use light canvas" }).click(); await page.screenshot({ path: resolve(artifacts, "campaign-builder-light.png"), fullPage: true });
  await page.getByRole("button", { name: "Contacts", exact: true }).click(); await page.getByRole("button", { name: "Compose & Send", exact: true }).click(); await page.locator('[data-id="email"]').click(); await expect(page.getByLabel("Subject line")).toHaveValue("A thoughtful hello");
  await page.reload(); await page.getByRole("button", { name: "Campaign History", exact: true }).click();
  await page.locator("tbody tr").filter({ hasText: prefix + " visual" }).getByRole("button", { name: "Open Visual Builder" }).click(); await expect(page.locator(".builder-mode-badge")).toHaveText("Build mode");
  await page.locator('[data-id="email"]').click(); await expect(page.getByLabel("Subject line")).toHaveValue("A thoughtful hello");
  expect(errors).toEqual([]);
});

test("CSV preview excludes invalid, duplicate, unknown and suppressed addresses", async ({ page }) => {
  const parsed = parseAudienceCsv('name,email\r\n"Doe, Alex", Good@Example.com\r\nAlex,good@example.com\r\nInvalid,no-address'); expect(parsed).toMatchObject({ emails: ["good@example.com"], duplicates: 1, invalid: [4], total: 3 });
  expect(() => parseAudienceCsv('email\n"unfinished')).toThrow("not closed");
  await page.goto("/"); await page.getByRole("button", { name: "Compose & Send", exact: true }).click();
  await page.locator('[data-id="audience"]').click();
  await page.getByLabel("CSV audience file").setInputFiles({ name: "audience.csv", mimeType: "text/csv", buffer: Buffer.from(`email,name\n${goodEmail},Eligible\n${goodEmail},Duplicate\n${blockedEmail},Blocked\nunknown-${run}@example.com,Unknown\nnot-an-email,Invalid`) });
  const csvPreview = page.locator(".csv-preview").filter({ has: page.getByRole("heading", { name: "CSV import preview", exact: true }) });
  await expect(csvPreview).toContainText("1 duplicates · 1 invalid · 1 unknown"); await expect(csvPreview).toContainText("1 eligible matches. 1 excluded");
  await page.getByRole("button", { name: "Use matched contacts" }).click(); await expect(page.locator(".audience-summary>div").first()).toContainText("1");
  await page.locator('[data-id="results"]').click(); await expect(page.getByRole("button", { name: "Launch campaign" })).toBeDisabled();
});

test("completed campaigns open read-only monitor with canonical recipient activity", async ({ page }) => {
  await page.goto("/"); await expect(page.getByRole("heading", { name: "Let's get things moving." })).toBeVisible();
  await page.getByRole("button", { name: "Campaign History", exact: true }).click();
  await page.locator("tbody tr").filter({ hasText: prefix + " monitor" }).getByRole("button", { name: "Open Visual Builder" }).click();
  await expect(page.locator(".builder-mode-badge")).toHaveText("Monitor mode"); await expect(page.locator(".monitor-status")).toContainText("Polling stopped");
  await page.getByRole("button", { name: "Unique opens", exact: false }).click(); await expect(page.locator(".result-record-list")).toContainText(goodEmail);
  await expect(page.getByRole("button", { name: "Save draft", exact: true })).toHaveCount(0);
  await page.locator('[data-id="email"]').click(); await expect(page.getByLabel("Subject line")).toBeDisabled();
  await page.mouse.move(0, 0); await page.screenshot({ path: resolve(artifacts, "campaign-builder-monitor.png"), fullPage: true });
});

test("mobile exposes all four configuration steps without overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto("/");
  await page.getByRole("button", { name: "Compose & Send", exact: true }).click();
  await page.getByRole("group", { name: "Campaign configuration steps" }).getByRole("button", { name: "Email", exact: true }).click();
  await expect(page.getByLabel("Subject line")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();
  await page.screenshot({ path: resolve(artifacts, "campaign-builder-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "Standard Editor", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Make something worth opening." })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();
});

test("conflicts preserve local edits and layout reload does not replace campaign content", async ({ page, context }) => {
  page.on("dialog", dialog => dialog.accept());
  const draft = { name: prefix + " conflict", subject: "Original subject", content_text: "Original content", sender_name: sender.sender_name, from_email: sender.from_email, reply_to: sender.reply_to ?? "", audience_contact_ids: [goodId] };
  const campaign = await (await context.request.post("/api/dashboard/campaigns", { data: draft })).json();
  await page.goto("/"); await expect(page.getByRole("heading", { name: "Let's get things moving." })).toBeVisible();
  await page.getByRole("button", { name: "Campaign History", exact: true }).click(); await page.locator("tbody tr").filter({ hasText: prefix + " conflict" }).getByRole("button", { name: "Open Visual Builder" }).click();
  await page.locator('[data-id="email"]').click(); await page.getByLabel("Subject line").fill("Local unsaved edit");
  const remote = await context.request.patch(`/api/dashboard/campaigns/${campaign.id}`, { data: { kind: "draft", expected_revision: 0, draft: { ...draft, subject: "Remote canonical edit" } } }); expect(remote.ok()).toBeTruthy();
  await page.getByRole("button", { name: "Save draft", exact: true }).click(); await expect(page.locator(".builder-banner.error")).toContainText("changed"); await expect(page.getByLabel("Subject line")).toHaveValue("Local unsaved edit");
  await page.getByRole("button", { name: "Reload saved campaign" }).click(); await page.locator('[data-id="email"]').click(); await expect(page.getByLabel("Subject line")).toHaveValue("Remote canonical edit");
  await page.getByLabel("Subject line").fill("Keep this local content");
  const layout = { ...defaultLayout, positions: { ...defaultLayout.positions, start: { x: 150, y: 150 } } };
  const layoutResponse = await context.request.patch(`/api/dashboard/campaigns/${campaign.id}`, { data: { kind: "layout", expected_revision: 0, layout } }); expect(layoutResponse.ok()).toBeTruthy();
  await page.getByRole("button", { name: "Save layout", exact: true }).click(); await expect(page.locator(".builder-banner.error")).toContainText("layout changed");
  await page.getByRole("button", { name: "Reload saved layout" }).click(); await page.locator('[data-id="email"]').click(); await expect(page.getByLabel("Subject line")).toHaveValue("Keep this local content");
});

test("monitor polling stops when the campaign finishes", async ({ page }) => {
  let calls = 0;
  await page.route(`**/api/dashboard/campaigns/${monitorId}`, async route => {
    const response = await route.fetch(); const body = await response.json();
    body.campaign.status = calls++ === 0 ? "sending" : "completed";
    await route.fulfill({ response, json: body });
  });
  await page.goto("/"); await expect(page.getByRole("heading", { name: "Let's get things moving." })).toBeVisible(); await page.getByRole("button", { name: "Campaign History", exact: true }).click();
  await page.locator("tbody tr").filter({ hasText: prefix + " monitor" }).getByRole("button", { name: "Open Visual Builder" }).click();
  await expect(page.locator(".monitor-status")).toContainText("Refreshing while active"); await expect(page.locator(".monitor-status")).toContainText("Polling stopped");
  const completedCalls = calls; await page.waitForTimeout(6500); expect(calls).toBe(completedCalls);
});

test("a failed campaign load can be retried without a page refresh", async ({ page }) => {
  await page.route(`**/api/dashboard/campaigns/${monitorId}`, route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Temporary campaign connection issue" }) }));
  await page.goto("/"); await expect(page.getByRole("heading", { name: "Let's get things moving." })).toBeVisible();
  await page.getByRole("button", { name: "Campaign History", exact: true }).click();
  await page.locator("tbody tr").filter({ hasText: prefix + " monitor" }).getByRole("button", { name: "Open Visual Builder" }).click();
  await expect(page.locator(".builder-banner.error")).toContainText("Temporary campaign connection issue");
  await page.unroute(`**/api/dashboard/campaigns/${monitorId}`);
  await page.getByRole("button", { name: "Retry opening campaign" }).click();
  await expect(page.locator(".builder-mode-badge")).toHaveText("Monitor mode");
  await expect(page.locator(".builder-banner.error")).toHaveCount(0);
});

test("audience validation errors remain visible and can be retried", async ({ page }) => {
  await page.route("**/api/dashboard/contacts/audience", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Audience validation temporarily unavailable" }) }));
  await page.goto("/"); await expect(page.getByRole("heading", { name: "Let's get things moving." })).toBeVisible();
  await page.getByRole("button", { name: "Compose & Send", exact: true }).click();
  await expect(page.locator(".builder-banner.error")).toContainText("Audience validation temporarily unavailable");
  await page.locator('[data-id="results"]').click();
  await expect(page.locator(".readiness-list")).toContainText("Audience eligibility could not be verified");
  await expect(page.getByRole("button", { name: "Validate audience", exact: true })).toBeEnabled();
  await page.unroute("**/api/dashboard/contacts/audience");
  await page.getByRole("button", { name: "Validate audience", exact: true }).click();
  await expect(page.getByRole("button", { name: "Validate audience", exact: true })).toBeEnabled();
  await expect(page.locator(".builder-banner.error")).toHaveCount(0);
});
