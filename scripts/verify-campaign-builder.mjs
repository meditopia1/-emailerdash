import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

const require = createRequire(resolve("apps/worker/package.json"));
const postgres = require("postgres");
const environment = { ...parseEnv(readFileSync(".env", "utf8")), ...process.env };
if (!environment.DATABASE_URL) throw new Error("DATABASE_URL is required");
const sql = postgres(environment.DATABASE_URL, { max: 1, connect_timeout: 15, onnotice: () => {} });
try {
  const [result] = await sql`
    select
      (select count(*)::integer from information_schema.columns where table_schema='public' and table_name='mail_campaigns' and column_name in ('audience_contact_ids','revision','workflow_layout','layout_revision')) as builder_columns,
      (select count(*)::integer from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('mail_campaigns','mail_contacts','mail_recipients','mail_events','mail_settings','mail_suppressions') and c.relrowsecurity and c.relforcerowsecurity) as rls_tables,
      (select count(*)::integer from public.mail_campaigns where name like 'BUILDER SIMULATION %') as test_campaigns,
      (select count(*)::integer from public.mail_contacts where consent_source='automated simulation') as test_contacts,
      (select count(*)::integer from public.mail_suppressions where source='automated builder simulation') as test_suppressions,
      (select count(*)::integer from public.mail_events where email like 'builder-%@example.com') as test_events,
      (select count(*)::integer from public.mail_settings where company_name like 'BUILDER SIMULATION %') as test_settings`;
  console.log(JSON.stringify(result));
  if (result.builder_columns !== 4 || result.rls_tables !== 6 || result.test_campaigns || result.test_contacts || result.test_suppressions || result.test_events || result.test_settings) process.exitCode = 1;
} catch (error) {
  console.error("Builder verification failed:", error.code ?? "database error"); process.exitCode = 1;
} finally { await sql.end(); }
