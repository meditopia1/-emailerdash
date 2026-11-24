import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
const require = createRequire(resolve("apps/worker/package.json"));
const env = parseEnv(readFileSync(".env", "utf8"));
const sql = require("postgres")(env.DATABASE_URL, { max: 1, connect_timeout: 15 });
const marker = randomUUID(); let checks = 0; const rollback = new Error("AUDIENCE_TEST_ROLLBACK");
const check = (value, message) => { assert.ok(value, message); checks++; };
const record = (email, extra = {}) => ({ email, first_name: "Audience", last_name: "Simulation", phone: "", company: "Audience Test", job_title: "", lifecycle_status: "prospect", lead_source: "audience simulation", notes: "Preserve this note", tags: [], list_ids: [], custom_fields: {}, ...extra });
const permission = { status: "granted", method: "double_opt_in", source: "Newsletter signup form", at: "2025-01-01T00:00:00Z", evidence: "test-only confirmation reference" };
try {
  const [before] = await sql`select count(*)::integer contacts from public.mail_contacts`;
  try {
    await sql.begin(async tx => {
      const [resources] = await tx`select public.mail_audience_metadata() as value`; check(Boolean(resources.value.resources), "metadata loads");
      const [page] = await tx`select public.mail_audience_query(${tx.json({ page: 0, page_size: 25 })}) as value`; check(page.value.contacts.length <= 25, "bounded pagination");
      const [dashboard] = await tx`select public.mail_dashboard_snapshot(false) as value,public.mail_dashboard_totals() as totals`;
      check(dashboard.value.contacts.length <= 100 && dashboard.value.campaigns.length <= 20 && dashboard.value.events.length <= 100 && dashboard.value.totals.delivered === dashboard.totals.delivered, "dashboard read remains bounded and preserves delivery totals");
      const [sending] = await tx`select public.mail_dashboard_snapshot(true) as value`;
      check(sending.value.campaigns.every(campaign => ["queued","sending"].includes(campaign.status)), "sending view excludes inactive campaigns");
      const [dashboardAccess] = await tx`select not has_function_privilege('anon','public.mail_dashboard_snapshot(boolean)','execute') and not has_function_privilege('authenticated','public.mail_dashboard_snapshot(boolean)','execute') as blocked`;
      check(dashboardAccess.blocked, "dashboard read stays private");
      const list = randomUUID(), field = randomUUID();
      await tx`select public.mail_audience_resource_save(${tx.json({ kind: "list", id: list, name: `Audience Test ${marker}`, description: "transaction rollback" })})`;
      await tx`select public.mail_audience_resource_save(${tx.json({ kind: "field", id: field, name: "Test score", key: `test_${marker.replaceAll("-", "")}`, type: "number", options: [] })})`;
      const create = async payload => (await tx`select public.mail_contact_save(${tx.json(payload)}) as id`)[0].id;
      const unknown = await create(record(`unknown-${marker}@example.com`));
      const grantedPayload = record(`granted-${marker}@example.com`, { consent: permission, tags: [`Newsletter ${marker}`], list_ids: [list], custom_fields: { [field]: 72 } });
      const granted = await create(grantedPayload);
      const [unknownState] = await tx`select eligible from public.mail_contact_audience where id=${unknown}`; check(!unknownState.eligible, "creation never grants consent");
      await assert.rejects(() => tx.savepoint(async sp => { await sp`select public.mail_contact_save(${sp.json(record(`bad-consent-${marker}@example.com`, { consent: { ...permission, source: "CSV", evidence: "" } }))})`; })); checks++;
      await assert.rejects(() => tx.savepoint(async sp => { await sp`select public.mail_contact_save(${sp.json(grantedPayload)})`; })); checks++;
      await tx`select public.mail_contact_save(${tx.json({ ...grantedPayload, company: "Day1Health", consent: undefined })},${granted})`;
      const [edited] = await tx`select company,consent_status,notes from public.mail_contacts where id=${granted}`; check(edited.company === "Day1Health" && edited.consent_status === "granted", "edit preserves permission");
      const [profile] = await tx`select public.mail_contact_profile(${granted},0) as value`;
      check(profile.value.contact.company === "Day1Health" && profile.value.contact.tags.length === 1 && profile.value.contact.custom_fields[field] === 72 && profile.value.consents.length === 1, "bounded profile aggregates contact, permission and custom fields");
      const [missingProfile] = await tx`select public.mail_contact_profile(${randomUUID()},0) as value`;
      check(missingProfile.value === null, "missing profile does not return another contact");
      const [profileAccess] = await tx`select not has_function_privilege('anon','public.mail_contact_profile(uuid,integer)','execute') and not has_function_privilege('authenticated','public.mail_contact_profile(uuid,integer)','execute') as blocked`;
      check(profileAccess.blocked, "profile RPC remains private");
      const filter = { join: "and", conditions: [{ field: "consent_status", op: "eq", value: "granted" }, { join: "or", conditions: [{ field: "tags", op: "contains", value: marker }, { field: "company", op: "eq", value: "impossible" }] }, { field: `custom.${field}`, op: "gt", value: 50 }] };
      const [filtered] = await tx`select public.mail_audience_query(${tx.json({ filter })}) as value`; check(filtered.value.count === 1 && filtered.value.contacts[0].id === granted, "nested AND/OR, tag and numeric custom filters");
      const [injection] = await tx`select public.mail_audience_query(${tx.json({ search: "%' OR true; --" })}) as value`; check(injection.value.count === 0, "search strings cannot become SQL");
      await assert.rejects(() => tx.savepoint(async sp => { await sp`select public.mail_audience_query(${sp.json({ filter: { field: "email);drop table mail_contacts;--", op: "eq", value: "x" } })})`; })); checks++;
      const segment = randomUUID(); await tx`select public.mail_audience_resource_save(${tx.json({ kind: "segment", id: segment, name: `Segment ${marker}`, description: "dynamic", filter })})`;
      const [staticPage] = await tx`select public.mail_audience_query(${tx.json({ list_id: list })}) as value`; check(staticPage.value.count === 1, "static list membership");
      const blocked = await create(record(`blocked-${marker}@example.com`, { consent: permission }));
      await tx`insert into public.mail_suppressions(normalized_email,reason,source) values(${`blocked-${marker}@example.com`},'unsubscribed','audience simulation')`;
      const [blockedState] = await tx`select consent_status,eligible from public.mail_contact_audience where id=${blocked}`; check(blockedState.consent_status === "unsubscribed" && !blockedState.eligible, "provider unsubscribe updates permission and exclusion");
      await assert.rejects(() => tx.savepoint(async sp => { await sp`select public.mail_contact_save(${sp.json(record(`blocked-${marker}@example.com`, { consent: permission }))},${blocked})`; })); checks++;
      const [preview] = await tx`select public.mail_preview_campaign_audience(${tx.json({ type: "contacts" })},${tx.array([granted, blocked, unknown])}::uuid[]) as value`;
      check(preview.value.eligible === 1 && preview.value.excluded === 2, "campaign exclusions remain enforced");
      check(preview.value.rows.find(row => row.id === granted).custom_fields[`test_${marker.replaceAll("-", "")}`] === 72, "personalization values projected by field key");
      const campaign = randomUUID(); await tx`insert into public.mail_campaigns(id,name,sender_name,from_email,subject,content_text,audience_selection) values(${campaign},${`Audience Test ${marker}`},'Test','preview@example.com','Preview only','No email sent',${tx.json({ type: "segment", id: segment })})`;
      const [original] = await tx`select public.mail_preview_campaign_audience(${tx.json({ type: "segment", id: segment })}) as value`;
      await create(record(`new-member-${marker}@example.com`, { consent: permission, tags: [`Newsletter ${marker}`], custom_fields: { [field]: 80 } }));
      await assert.rejects(() => tx.savepoint(async sp => { await sp`select public.mail_approve_campaign_audience(${campaign},0,${original.value.fingerprint})`; })); checks++;
      const [changed] = await tx`select public.mail_preview_campaign_audience(${tx.json({ type: "segment", id: segment })}) as value`;
      check(changed.value.selected === 2, "dynamic membership is reevaluated before approval");
      const [approval] = await tx`select public.mail_approve_campaign_audience(${campaign},0,${changed.value.fingerprint}) as value`; check(approval.value.eligible === 2, "operator-reviewed snapshot saved");
      await create(record(`later-member-${marker}@example.com`, { consent: permission, tags: [`Newsletter ${marker}`], custom_fields: { [field]: 90 } }));
      const [frozen] = await tx`select jsonb_array_length(recipient_snapshot)::integer recipients from public.mail_campaign_audience_approvals where id=${approval.value.id}`; check(frozen.recipients === 2, "approved audience never expands silently");
      const job = randomUUID();
      await tx`insert into public.mail_contact_imports(id,file_name,fingerprint,total_rows,mode,mapping) values(${job},'transaction-only.csv',${"a".repeat(64)},6,'update','{}')`;
      const importedEmail = `import-${marker}@example.com`;
      const batch = [
        { row_number: 1, data: { ...record(`blocked-${marker}@example.com`, { consent: permission }), _supplied: { email: `blocked-${marker}@example.com`, company: "Imported company", consent: permission } } },
        { row_number: 2, data: record(importedEmail) }, { row_number: 3, data: record(importedEmail) },
        { row_number: 4, data: { email: "not-an-email" }, error: "Invalid email address" },
        { row_number: 5, data: record(`import-granted-${marker}@example.com`, { consent: permission }) },
        { row_number: 6, data: { ...record(`granted-${marker}@example.com`), _supplied: { email: `granted-${marker}@example.com`, phone: "+12125550101" } } },
      ];
      await tx`select public.mail_import_stage(${job},${tx.json(batch)})`;
      const [staged] = await tx`select public.mail_import_stage(${job},${tx.json(batch)}) as count`; check(staged.count === 6, "upload batch replay is idempotent");
      await tx`update public.mail_contact_imports set status='queued' where id=${job}`;
      await assert.rejects(() => tx.savepoint(async sp => { await sp`select public.mail_process_import_batch(${job},2)`; throw new Error("simulated restart"); }));
      const [rolledBatch] = await tx`select processed_count from public.mail_contact_imports where id=${job}`; check(rolledBatch.processed_count === 0, "interrupted batch rolls back atomically");
      await tx`select public.mail_process_import_batch(${job},2)`;
      const [partial] = await tx`select status,processed_count from public.mail_contact_imports where id=${job}`; check(partial.status === "running" && partial.processed_count === 2, "bounded processing saves progress");
      await tx`select public.mail_process_import_batch(${job},100)`;
      const [completed] = await tx`select status,imported_count,updated_count,duplicate_count,invalid_count,failed_count from public.mail_contact_imports where id=${job}`;
      check(completed.status === "completed" && completed.imported_count === 2 && completed.updated_count === 2 && completed.duplicate_count === 1 && completed.invalid_count === 1 && completed.failed_count === 0, `correct import outcomes: ${JSON.stringify(completed)}`);
      const [protectedContact] = await tx`select c.consent_status,c.company,c.notes,s.reason from public.mail_contacts c join public.mail_suppressions s on s.normalized_email=c.normalized_email where c.id=${blocked}`;
      check(protectedContact.consent_status === "unsubscribed" && protectedContact.reason === "unsubscribed" && protectedContact.company === "Imported company", "import updates profile without restoring withdrawn consent");
      const [preserved] = await tx`select company,phone,notes,consent_status from public.mail_contacts where id=${granted}`;
      check(preserved.company === "Day1Health" && preserved.phone === "+12125550101" && preserved.notes === "Preserve this note" && preserved.consent_status === "granted", "unmapped fields and consent survive import updates");
      const [newState] = await tx`select consent_status from public.mail_contacts where email=${importedEmail}`; check(newState.consent_status === "unknown", "CSV provenance does not grant consent");
      await tx`select public.mail_contact_bulk('archive',${tx.array([granted])}::uuid[])`;
      const [archived] = await tx`select eligible from public.mail_contact_audience where id=${granted}`; check(!archived.eligible, "archived contact excluded");
      await tx`insert into public.mail_contacts(email,lead_source) select 'page-'||n::text||'-'||${marker}||'@example.com',${marker} from generate_series(1,1500) n`;
      const criteria = { filter: { field: "lead_source", op: "eq", value: marker }, page_size: 25 };
      const [first] = await tx`select public.mail_audience_query(${tx.json({ ...criteria, page: 0 })}) as value`;
      const [last] = await tx`select public.mail_audience_query(${tx.json({ ...criteria, page: 59 })}) as value`;
      check(first.value.count === 1500 && last.value.contacts.length === 25 && !first.value.contacts.some(a => last.value.contacts.some(b => a.id === b.id)), "large dataset pagination remains bounded and deterministic");
      await assert.rejects(() => tx.savepoint(async sp => { await sp`select public.mail_preview_campaign_audience(${sp.json({ type: "filter", filter: criteria.filter })})`; })); checks++;
      const [security] = await tx`select not has_table_privilege('anon','public.mail_contact_import_rows','select') as private_rows,not has_function_privilege('anon','public.mail_contact_save(jsonb,uuid,boolean)','execute') as private_rpc`;
      check(security.private_rows && security.private_rpc, "private table and RPC grants");
      throw rollback;
    });
  } catch (error) { if (error !== rollback) throw error; }
  const [after] = await sql`select count(*)::integer contacts from public.mail_contacts`;
  check(before.contacts === after.contacts, "test contacts rolled back");
  console.log(JSON.stringify({ audienceChecks: checks, rollback: true, existingContactsPreserved: true }));
} catch (error) { console.error(JSON.stringify({ audienceChecks: checks, error: String(error.message).replace(/postgres(?:ql)?:\/\/\S+/g, "[redacted]"), code: error.code ?? null })); process.exitCode = 1; }
finally { await sql.end(); }
