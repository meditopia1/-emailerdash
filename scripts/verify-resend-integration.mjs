import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
const require = createRequire(resolve("apps/worker/package.json"));
const sql = require("postgres")(parseEnv(readFileSync(".env", "utf8")).DATABASE_URL, { max: 1, connect_timeout: 15 });
try {
  const [security] = await sql`select count(*)::integer mail_tables, bool_and(c.relrowsecurity and c.relforcerowsecurity) forced_rls
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname like 'mail_%'`;
  const [cleanup] = await sql`select
    (select count(*)::integer from public.mail_campaigns where name like 'BUILDER SIMULATION %' or name like 'WEBHOOK SIMULATION %' or name like 'RESEND SENDER SIMULATION %' or name = 'RESEND TRANSACTION SIMULATION') fixture_campaigns,
    (select count(*)::integer from public.mail_contacts where consent_source='automated simulation') fixture_contacts,
    (select count(*)::integer from public.mail_sending_domains where domain ~ '^test-[0-9a-f-]{36}[.]example[.]com$' or domain ~ '^updates-[0-9a-f-]{36}[.]example[.]com$') fixture_domains,
    (select count(*)::integer from public.mail_events where email like 'resend-webhook-%@example.com' or email like 'builder-%@example.com' or payload->>'provider_message_id' like 'mock-http-%') fixture_events,
    (select count(*)::integer from public.mail_suppressions where source='automated builder simulation' or normalized_email like 'resend-webhook-%@example.com') fixture_suppressions,
    (select count(*)::integer from public.mail_settings where sender_name like 'BUILDER SIMULATION %' or sender_name like 'WEBHOOK SIMULATION %' or sender_name like 'RESEND SENDER SIMULATION %') fixture_settings`;
  console.log(JSON.stringify({ ...security, ...cleanup }));
} finally { await sql.end(); }
