import { expect, test, type Page } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync, mkdirSync } from "node:fs";
import { parseEnv } from "node:util";
import { resolve } from "node:path";
import { createRequire } from "node:module";
const env = { ...parseEnv(readFileSync(resolve(".env"), "utf8")), ...parseEnv(readFileSync(resolve("apps/web/.env.local"), "utf8")) };
const require = createRequire(resolve("apps/worker/package.json")); const sql = require("postgres")(env.DATABASE_URL, { max: 1, connect_timeout: 15 });
const run = randomUUID(); const source = `AUDIENCE UI SIMULATION ${run}`; const company = `Company ${run}`; const tag = `UI ${run}`;
const ids = Array.from({ length: 40 }, () => randomUUID()); const field = randomUUID(), list = randomUUID(), segment = randomUUID(), campaignId = randomUUID(); const created: string[] = []; const imports: string[] = []; const createdFields: string[] = [];
const artifacts = resolve("artifacts/ui"); mkdirSync(artifacts, { recursive: true });
test.beforeAll(async () => {
  await sql.begin(async (tx: typeof sql) => {
    await tx`insert into public.mail_contact_fields(id,name,key,type,options) values(${field},${`Interest ${run}`},${`ui_${run.replaceAll("-", "")}`},'single_select','["Health","Software"]')`;
    await tx`insert into public.mail_contact_lists(id,name,description) values(${list},${`List ${run}`},'UI test static list')`;
    await tx`insert into public.mail_audience_segments(id,name,filter) values(${segment},${`Segment ${run}`},${tx.json({ field: "company", op: "eq", value: company })})`;
    const contacts = ids.map((id, index) => ({ id, email: `audience-${index}-${run}@example.com`, name: `Audience ${String(index).padStart(2, "0")}`, first_name: "Audience", last_name: String(index).padStart(2, "0"), company, lead_source: source, consent_status: index < 20 ? "granted" : "unknown", consent_source: index < 20 ? "Signup form" : null, consented_at: index < 20 ? new Date("2025-01-01T00:00:00Z") : null, consent_method: "double_opt_in", consent_evidence: index < 20 ? "UI test reference" : "" }));
    await tx`insert into public.mail_contacts ${tx(contacts)}`;
    const [savedTag] = await tx`insert into public.mail_contact_tags(name) values(${tag}) returning id`;
    await tx`insert into public.mail_contact_tag_memberships(contact_id,tag_id) select id,${savedTag.id}::uuid from public.mail_contacts where lead_source=${source}`;
    await tx`insert into public.mail_contact_list_memberships(list_id,contact_id) select ${list}::uuid,id from public.mail_contacts where lead_source=${source}`;
    await tx`insert into public.mail_contact_field_values(contact_id,field_id,value) select id,${field}::uuid,'"Health"'::jsonb from public.mail_contacts where lead_source=${source} and consent_status='granted'`;
    await tx`insert into public.mail_suppressions(normalized_email,reason,source) values(${`audience-0-${run}@example.com`},'unsubscribed',${source})`;
    await tx`insert into public.mail_campaigns(id,name,sender_name,from_email,subject,content_text) values(${campaignId},${source},'Audience Test','preview@example.com','Audience test','Hello {{name}}')`;
  });
});
test.afterAll(async () => {
  try {
    // Exact test-owned identifiers only. Cascades remove their own logs, never pre-existing user records.
    if (imports.length) await sql`delete from public.mail_contact_imports where id=any(${sql.array(imports)}::uuid[])`;
    await sql`delete from public.mail_campaigns where id=${campaignId}`;
    await sql`delete from public.mail_contacts where lead_source=${source} or id=any(${sql.array(created)}::uuid[]) or email like ${`import-%-${run}@example.com`}`;
    await sql`delete from public.mail_suppressions where source=${source}`;
    await sql`delete from public.mail_audience_segments where id=${segment} or name=${`Saved segment ${run}`}`;
    await sql`delete from public.mail_contact_lists where id=${list}`;
    await sql`delete from public.mail_contact_fields where id=${field}`;
    if (createdFields.length) await sql`delete from public.mail_contact_fields where id=any(${sql.array(createdFields)}::uuid[])`;
    await sql`delete from public.mail_contact_tags where name=${tag} or name=${`Bulk ${run}`}`;
    const [left] = await sql`select count(*)::integer count from public.mail_contacts where lead_source=${source}`; expect(left.count).toBe(0);
  } finally { await sql.end(); }
});
test.beforeEach(async ({ context, page }) => {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600, nonce: "audience-tests" })).toString("base64url"); const signature = createHmac("sha256", env.ADMIN_SESSION_SECRET).update(payload).digest("base64url");
  await context.addCookies([{ name: "marketing_os_admin", value: `${payload}.${signature}`, url: "http://localhost:3001", httpOnly: true, sameSite: "Lax" }]);
  await page.route("**/api/dashboard/overview*", route => route.fulfill({ json: { campaigns: [], contacts: [], events: [], settings: null, totals: {} } }));
  page.on("dialog", dialog => dialog.accept());
});
async function open(page: Page) { await page.goto("/"); await page.getByRole("button", { name: "Contacts", exact: true }).click(); await expect(page.getByRole("heading", { name: /Audience contacts/ })).toBeVisible(); }
async function filtered(page: Page) { await open(page); await page.getByRole("searchbox", { name: "Search contacts", exact: true }).fill(company); await expect(page.locator(".audience-pagination").first()).toContainText("40 matching contacts"); }
async function fit(page: Page) { expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true); }

test("server search, pagination, columns, sorting and selection remain bounded", async ({ page }) => {
  test.setTimeout(90000); const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await filtered(page); await expect(page.locator(".audience-table tbody tr")).toHaveCount(25);
  await page.getByRole("button", { name: "Next contact page", exact: true }).click(); await expect(page.locator(".audience-table tbody tr")).toHaveCount(15);
  await page.getByRole("button", { name: "Previous contact page", exact: true }).click(); await expect(page.locator(".audience-table tbody tr")).toHaveCount(25);
  await page.getByRole("button", { name: "Columns", exact: true }).click(); await page.locator(".audience-column-menu").getByLabel("Phone", { exact: true }).check(); await page.getByRole("button", { name: "Columns", exact: true }).click();
  await expect(page.getByRole("columnheader", { name: "Phone", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Name", exact: true }).click(); await expect(page.getByRole("columnheader", { name: /Name/ })).toHaveAttribute("aria-sort", /ascending|descending/);
  await page.getByRole("checkbox", { name: "Select current contact page", exact: true }).check(); await expect(page.locator(".audience-bulk-bar")).toContainText("25 selected");
  const downloading = page.waitForEvent("download"); await page.getByRole("button", { name: "Export 25 selected", exact: true }).click(); const exportFile = await downloading; const exportText = readFileSync((await exportFile.path())!, "utf8"); expect(exportText).toContain(tag); expect(exportText).toContain(`custom.ui_${run.replaceAll("-", "")}`);
  await fit(page); await page.mouse.move(0, 0); await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: resolve(artifacts, "audience-centre-desktop.png"), fullPage: true, animations: "disabled" }); expect(errors).toEqual([]);
});

test("contact creation records existing opt-in without consent fields, persists, edits and rejects duplicates", async ({ page }) => {
  test.setTimeout(90000); await open(page); await page.getByRole("button", { name: "Add contact", exact: true }).first().click();
  const drawer = page.getByRole("dialog", { name: "Add contact", exact: true }); const email = `manual-${run}@example.com`;
  await expect(drawer.getByText(/Marketing permission/)).toHaveCount(0);
  await expect(drawer.getByLabel("Record a new consent decision")).toHaveCount(0);
  await expect(drawer.getByLabel("Consent evidence or reference")).toHaveCount(0);
  await drawer.getByLabel("Email address", { exact: true }).fill(email); await drawer.getByLabel("First name", { exact: true }).fill("Created"); await drawer.getByLabel("Lead source", { exact: true }).fill(source);
  await page.screenshot({ path: resolve(artifacts, "add-contact-simplified-desktop.png"), animations: "disabled" });
  await page.setViewportSize({ width: 390, height: 844 }); await fit(page);
  await page.screenshot({ path: resolve(artifacts, "add-contact-simplified-mobile.png"), animations: "disabled" });
  await page.setViewportSize({ width: 1440, height: 1060 });
  page.on("request", request => { if (request.url().endsWith("/api/dashboard/contacts") && request.method() === "POST") { const id = request.postDataJSON().id; if (id) created.push(id); } });
  const saved = page.waitForResponse(response => response.url().endsWith("/api/dashboard/contacts") && response.request().method() === "POST");
  await drawer.getByRole("button", { name: "Save contact", exact: true }).click(); const response = await saved; expect(response.status()).toBe(201); created.push((await response.json()).id);
  await expect(page.getByRole("dialog", { name: "Created", exact: true })).toBeVisible(); await expect(page.locator(".audience-profile-head")).toContainText("Eligible");
  const [permission] = await sql`select c.consent_status,c.consent_method,a.eligible,(select count(*)::int from public.mail_contact_consents cc where cc.contact_id=c.id) ledger_count from public.mail_contacts c join public.mail_contact_audience a on a.id=c.id where c.normalized_email=${email}`;
  expect(permission).toMatchObject({ consent_status: "granted", consent_method: "administrator_attestation", eligible: true, ledger_count: 1 });
  await page.getByRole("button", { name: "Edit contact", exact: true }).click(); const edit = page.getByRole("dialog", { name: "Edit contact", exact: true }); await edit.getByLabel("Company", { exact: true }).fill("Edited company"); await edit.getByRole("button", { name: "Save contact", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Created", exact: true })).toContainText("Edited company"); await page.getByRole("button", { name: "Close profile", exact: true }).click();
  const [afterEdit] = await sql`select count(*)::int count from public.mail_contact_consents cc join public.mail_contacts c on c.id=cc.contact_id where c.normalized_email=${email}`;
  expect(afterEdit.count).toBe(1);
  await page.reload(); await page.getByRole("button", { name: "Contacts", exact: true }).click(); await page.getByRole("searchbox", { name: "Search contacts", exact: true }).fill(email); await expect(page.locator(".audience-table tbody tr")).toHaveCount(1);
  await page.getByRole("button", { name: "Add contact", exact: true }).first().click(); await page.getByRole("dialog", { name: "Add contact", exact: true }).getByLabel("Email address", { exact: true }).fill(email); await page.getByRole("button", { name: "Save contact", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Add contact", exact: true }).locator(".audience-error")).toContainText("already exists");
});

test("simplified add cannot bypass suppression or overwrite an unsubscribed contact", async ({ page }) => {
  test.setTimeout(90000);
  const email = `blocked-new-${run}@example.com`;
  await sql`insert into public.mail_suppressions(normalized_email,reason,source) values(${email},'unsubscribed',${source})`;
  await open(page); await page.getByRole("button", { name: "Add contact", exact: true }).first().click();
  const drawer = page.getByRole("dialog", { name: "Add contact", exact: true });
  await drawer.getByLabel("Email address", { exact: true }).fill(email);
  await drawer.getByRole("button", { name: "Save contact", exact: true }).click();
  await expect(drawer.locator(".audience-error")).toContainText(/suppressed|blocked/i);
  const [blocked] = await sql`select count(*)::int count from public.mail_contacts where normalized_email=${email}`;
  expect(blocked.count).toBe(0);
  await drawer.getByLabel("Email address", { exact: true }).fill(`audience-0-${run}@example.com`);
  await drawer.getByRole("button", { name: "Save contact", exact: true }).click();
  await expect(drawer.locator(".audience-error")).toContainText("already exists");
  const [unchanged] = await sql`select c.consent_status,a.eligible from public.mail_contacts c join public.mail_contact_audience a on a.id=c.id where c.id=${ids[0]}`;
  expect(unchanged).toEqual({ consent_status: "unsubscribed", eligible: false });
});

test("profiles, bulk tags, static lists and dynamic filter definitions work", async ({ page }) => {
  test.setTimeout(90000); await filtered(page);
  await page.getByRole("searchbox", { name: "Search contacts", exact: true }).fill(`audience-1-${run}@example.com`); await expect(page.locator(".audience-table tbody tr")).toHaveCount(1);
  await page.getByRole("checkbox", { name: `Select audience-1-${run}@example.com`, exact: true }).check(); await page.getByRole("button", { name: "Add tag", exact: true }).click();
  const tagDialog = page.getByRole("dialog", { name: "Tag selected contacts" }); await tagDialog.getByRole("textbox").fill(`Bulk ${run}`); await tagDialog.getByRole("button", { name: "Apply to selected", exact: true }).click(); await expect(tagDialog).toHaveCount(0);
  await page.getByRole("button", { name: "Audience 01", exact: true }).click(); const profile = page.getByRole("dialog", { name: "Audience 01", exact: true });
  await expect(profile).toContainText(`Bulk ${run}`); for (const tab of ["Email activity", "Consent", "History", "Overview"]) { await profile.getByRole("button", { name: tab, exact: true }).click(); }
  await page.screenshot({ path: resolve(artifacts, "audience-contact-profile.png"), fullPage: true, animations: "disabled" }); await profile.getByRole("button", { name: "Close profile", exact: true }).click();
  await page.getByRole("button", { name: "Segments", exact: true }).click(); await page.getByRole("button", { name: "Create segment", exact: true }).click(); const segmentDialog = page.getByRole("dialog", { name: "Create dynamic segment" });
  await segmentDialog.getByLabel("Name", { exact: true }).fill(`Saved segment ${run}`); await segmentDialog.getByRole("button", { name: "Add condition", exact: true }).click(); await segmentDialog.getByRole("combobox", { name: "Filter field", exact: true }).selectOption("company"); await segmentDialog.getByLabel("Filter value", { exact: true }).fill(company);
  await segmentDialog.getByRole("button", { name: "Add AND/OR group", exact: true }).click(); await segmentDialog.getByRole("combobox", { name: "Filter field", exact: true }).last().selectOption("tags"); await segmentDialog.getByLabel("Filter value", { exact: true }).last().fill(tag);
  await segmentDialog.getByRole("button", { name: "Preview matching contacts", exact: true }).click(); await expect(segmentDialog.getByRole("status")).toHaveText("40 matching contacts");
  await page.screenshot({ path: resolve(artifacts, "audience-segment-filters.png"), fullPage: true, animations: "disabled" }); await segmentDialog.getByRole("button", { name: "Save segment", exact: true }).click(); await expect(segmentDialog).toHaveCount(0);
  await page.getByRole("button", { name: "Lists", exact: true }).click(); const item = page.locator(".audience-resource-list article").filter({ hasText: `List ${run}` }); await expect(item).toContainText("40 contacts"); await item.getByRole("button", { name: "View contacts", exact: true }).click(); await expect(page.locator(".audience-pagination").first()).toContainText("40 matching contacts");
});

test("CSV mapping, conflict updates, consent protection and error reports persist", async ({ page }) => {
  test.setTimeout(120000); await open(page); await page.getByRole("button", { name: "Import contacts", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Import contacts", exact: true });
  const csv = `Client Email,First Name,Organisation,Lead Source\nimport-new-${run}@example.com,Imported,Imported company,${source}\nnot-an-email,Invalid,Company,${source}\nimport-new-${run}@example.com,Duplicate,Company,${source}\naudience-0-${run}@example.com,Updated,Changed company,${source}`;
  await drawer.getByLabel("Contact import CSV").setInputFiles({ name: `audience-${run}.csv`, mimeType: "text/csv", buffer: Buffer.from(csv) }); await expect(drawer.getByLabel("Map Client Email")).toHaveValue("email"); await drawer.getByRole("button", { name: "Validate rows", exact: true }).click();
  await expect(drawer).toContainText("existing"); await expect(drawer).toContainText("invalid"); await drawer.getByLabel("Existing contact handling").selectOption("update");
  const jobResponse = page.waitForResponse(response => response.url().endsWith("/api/dashboard/contacts/imports") && response.request().postDataJSON()?.action === "create");
  await drawer.getByRole("button", { name: "Start import", exact: true }).click(); const reply = await jobResponse;
  // Track the client-generated fixture ID even if acknowledgement is lost. Never replay a write.
  imports.push(reply.request().postDataJSON().id); expect(reply.status(), await reply.text()).toBe(201); const job = (await reply.json()).job; expect(job.id).toBe(imports.at(-1));
  await expect(drawer.getByRole("button", { name: "Process next 100", exact: true })).toBeVisible(); await drawer.getByRole("button", { name: "Process next 100", exact: true }).click(); await expect(drawer.locator(".audience-import-job .audience-badge").first()).toHaveText("completed");
  await expect(drawer.locator(".audience-import-counts")).toContainText("Duplicates1"); await page.screenshot({ path: resolve(artifacts, "audience-import-results.png"), fullPage: true, animations: "disabled" });
  const downloaded = page.waitForEvent("download"); await drawer.getByRole("button", { name: /Error report/ }).click(); const download = await downloaded; const path = await download.path(); expect(readFileSync(path!, "utf8")).toContain("Invalid email");
  const [blocked] = await sql`select consent_status,company from public.mail_contacts where id=${ids[0]}`; expect(blocked.consent_status).toBe("unsubscribed"); expect(blocked.company).toBe("Changed company");
  const [fresh] = await sql`select consent_status from public.mail_contacts where email=${`import-new-${run}@example.com`}`; expect(fresh.consent_status).toBe("unknown");
});

test("dark/light themes, drawer and mobile layouts fit", async ({ page }) => {
  test.setTimeout(90000); await open(page); await expect(page.locator(".audience-table tbody tr")).toHaveCount(25); await page.setViewportSize({ width: 390, height: 844 }); await fit(page); await page.mouse.move(0, 0); await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: resolve(artifacts, "audience-centre-mobile.png"), fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "Add contact", exact: true }).first().click(); await expect(page.getByRole("dialog", { name: "Add contact" })).toBeVisible(); await fit(page); await page.screenshot({ path: resolve(artifacts, "audience-create-mobile.png"), fullPage: false, animations: "disabled" }); await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click(); await page.getByRole("button", { name: "Dark", exact: true }).click(); await page.getByRole("button", { name: "Contacts", exact: true }).click(); await expect(page.locator(".audience-table tbody tr")).toHaveCount(25); await fit(page); await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: resolve(artifacts, "audience-centre-dark-mobile.png"), fullPage: true, animations: "disabled" });
});

test("private audience APIs reject anonymous and cross-origin mutations", async ({ context, playwright }) => {
  const anonymous = await playwright.request.newContext({ baseURL: "http://localhost:3001" });
  for (const path of ["contacts", "contacts/resources", "contacts/imports", `contacts/${ids[0]}`]) expect((await anonymous.get(`/api/dashboard/${path}`)).status()).toBe(401);
  expect((await context.request.post("/api/dashboard/contacts/bulk", { headers: { origin: "https://untrusted.example" }, data: { action: "archive", ids } })).status()).toBe(403);
  const bounded = await context.request.get(`/api/dashboard/contacts?page_size=101`); expect(bounded.status()).toBe(400);
  await anonymous.dispose();
});

test("campaign builder selects a dynamic segment, previews custom values and freezes approved recipients", async ({ page }) => {
  test.setTimeout(120000);
  const [campaign] = await sql`select id,name,status,total_count,accepted_count,delivered_count,opened_count,clicked_count,failed_count,blocked_count,created_at from public.mail_campaigns where id=${campaignId}`;
  await page.route("**/api/dashboard/overview*", route => route.fulfill({ json: { campaigns: [campaign], contacts: [], events: [], settings: null, totals: {} } }));
  await page.goto("/"); await page.getByRole("button", { name: "Campaign History", exact: true }).click(); await page.getByRole("button", { name: "Open Visual Builder", exact: true }).click();
  await page.getByRole("button", { name: "Standard Editor", exact: true }).click();
  await page.getByLabel("Audience source", { exact: true }).selectOption(`segment:${segment}`);
  await page.getByLabel("Email content", { exact: true }).fill(`Hello {{custom.ui_${run.replaceAll("-", "")}}}`);
  await expect(page.locator(".audience-summary")).toContainText("19Eligible");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("button", { name: "Approve recipient snapshot", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Approve recipient snapshot", exact: true }).click();
  await expect(page.locator(".audience-fields")).toContainText("19 eligible recipients frozen");
  const [snapshot] = await sql`select eligible_count,jsonb_array_length(recipient_snapshot)::integer recipients from public.mail_campaign_audience_approvals where campaign_id=${campaignId} order by approved_at desc limit 1`;
  expect(snapshot.eligible_count).toBe(19); expect(snapshot.recipients).toBe(19);
  const [queue] = await sql`select count(*)::integer count from public.mail_recipients where campaign_id=${campaignId}`; expect(queue.count).toBe(0);
  await page.getByRole("button", { name: "Preview email", exact: true }).first().click(); await expect(page.getByRole("dialog", { name: "Email preview" })).toContainText("Hello Health");
  await page.screenshot({ path: resolve(artifacts, "audience-campaign-preview.png"), fullPage: true, animations: "disabled" });
});

test("custom field creation, explicit consent ledger and archive controls persist", async ({ page }) => {
  test.setTimeout(120000); await open(page); await page.getByRole("button", { name: "Fields", exact: true }).click(); await page.getByRole("button", { name: "Create field", exact: true }).click();
  const fieldDialog = page.getByRole("dialog", { name: "Create custom field", exact: true }); const region = `Region ${run}`;
  await fieldDialog.getByLabel("Name", { exact: true }).fill(region); await fieldDialog.getByLabel("Personalization key", { exact: true }).fill(`region_${run.replaceAll("-", "")}`); await fieldDialog.getByLabel("Field type", { exact: true }).selectOption("single_select"); await fieldDialog.getByLabel("Select options", { exact: true }).fill("North\nSouth");
  const savedField = page.waitForResponse(response => response.url().endsWith("/contacts/resources") && response.request().method() === "POST"); await fieldDialog.getByRole("button", { name: "Save field", exact: true }).click(); createdFields.push((await (await savedField).json()).id); await expect(page.locator(".audience-resource-list")).toContainText(region);
  await page.getByRole("navigation", { name: "Audience sections" }).getByRole("button", { name: "Contacts", exact: true }).click(); await page.getByRole("button", { name: "Add contact", exact: true }).first().click(); const editor = page.getByRole("dialog", { name: "Add contact", exact: true });
  await editor.getByLabel("Email address", { exact: true }).fill(`permission-${run}@example.com`); await editor.getByLabel("First name", { exact: true }).fill("Permission"); await editor.getByLabel("Lead source", { exact: true }).fill(source); await editor.getByText("Lists, custom fields & notes", { exact: true }).click(); await editor.getByLabel(region, { exact: true }).selectOption("North");
  await expect(editor.getByText(/Marketing permission/)).toHaveCount(0);
  const saved = page.waitForResponse(response => response.url().endsWith("/api/dashboard/contacts") && response.request().method() === "POST"); await editor.getByRole("button", { name: "Save contact", exact: true }).click(); created.push((await (await saved).json()).id);
  const profile = page.getByRole("dialog", { name: "Permission", exact: true }); await expect(profile.locator(".audience-profile-head")).toContainText("Eligible"); await expect(profile).toContainText("North");
  await profile.getByRole("button", { name: "Edit contact", exact: true }).click(); const edit = page.getByRole("dialog", { name: "Edit contact", exact: true });
  await edit.getByText("Marketing permission · granted", { exact: true }).click(); await edit.getByLabel("Record a new consent decision", { exact: true }).check(); await edit.getByLabel("Consent status", { exact: true }).selectOption("granted"); await edit.getByLabel("Consent method", { exact: true }).fill("Double opt-in"); await edit.getByLabel("Original permission source", { exact: true }).fill("Website signup"); await edit.getByLabel("Consent timestamp", { exact: true }).fill("2025-01-01T12:00"); await edit.getByLabel("Consent evidence or reference", { exact: true }).fill(`Confirmation ${run}`);
  await edit.getByRole("button", { name: "Save contact", exact: true }).click(); await expect(profile).toBeVisible();
  await profile.getByRole("button", { name: "Consent", exact: true }).click(); await expect(profile).toContainText(`Confirmation ${run}`); await expect(profile).toContainText("administrator_attestation");
  await profile.getByRole("button", { name: "Archive contact", exact: true }).click(); await expect(profile.locator(".audience-profile-head")).toContainText("Archived"); await profile.getByRole("button", { name: "Restore contact", exact: true }).click(); await expect(profile.locator(".audience-profile-head")).toContainText("Eligible");
});

test("failed audience reads stay errors, retry restores, and cached rows are marked stale", async ({ page }) => {
  test.setTimeout(90000); let failing = true; await page.route("**/api/dashboard/contacts?*", route => failing ? route.fulfill({ status: 503, json: { error: "Simulated audience storage outage" } }) : route.continue());
  await open(page); await expect(page.locator(".audience-error")).toContainText("Simulated audience storage outage"); await expect(page.locator(".audience-empty")).toHaveCount(0);
  failing = false; await page.getByRole("button", { name: "Retry contacts", exact: true }).click(); await expect(page.locator(".audience-table tbody tr")).toHaveCount(25); await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Connection restored" })).toBeVisible();
  failing = true; await page.getByRole("button", { name: "Refresh dashboard", exact: true }).click(); await expect(page.locator(".audience-error")).toContainText("may be outdated"); await expect(page.locator(".audience-table tbody tr")).toHaveCount(25); await expect(page.locator(".audience-empty")).toHaveCount(0);
});
