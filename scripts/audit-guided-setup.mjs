import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
const require = createRequire(resolve("apps/worker/package.json"));
const environment = { ...parseEnv(readFileSync(".env", "utf8")), ...process.env };
const sql = require("postgres")(environment.DATABASE_URL, { max: 1, connect_timeout: 15, onnotice: () => {} });
// This change's CLI-generated migration timestamp. Older records belong to the user.
const since = "2026-11-22T04:42:03.000Z";
try {
  const result = await sql.begin(async tx => {
    await tx`set transaction read only`;
    const [security] = await tx`select not prosecdef as security_invoker,
      not has_function_privilege('anon',oid,'execute') as anon_denied,
      not has_function_privilege('authenticated',oid,'execute') as authenticated_denied,
      has_function_privilege('service_role',oid,'execute') as service_allowed
      from pg_proc where oid='public.mail_guided_setup_facts()'::regprocedure`;
    const [tables] = await tx`select bool_and(c.relrowsecurity and c.relforcerowsecurity) as forced_rls,
      bool_and(not has_table_privilege('anon',c.oid,'select') and not has_table_privilege('authenticated',c.oid,'select')) as browser_roles_denied
      from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r' and c.relname like 'mail_%'`;
    const [fixtures] = await tx`select
      (select count(*)::integer from public.mail_contacts where imported_at>=${since}::timestamptz and (lead_source ~ '^AUDIENCE UI SIMULATION [0-9a-f-]{36}$' or email ~ '^((future-)?builder-|blocked-)[0-9a-f-]{36}@example\.com$')) as audience_builder_contacts,
      (select count(*)::integer from public.mail_campaigns where created_at>=${since}::timestamptz and (name like 'BUILDER SIMULATION %' or name='Guided setup fixture')) as campaign_fixtures,
      (select count(*)::integer from public.mail_contact_imports where created_at>=${since}::timestamptz and file_name ~ '^audience-[0-9a-f-]{36}\.csv$') as uniquely_named_import_fixtures`;
    const [legacy] = await tx`select count(*)::integer as unclassified_generic_csv_jobs from public.mail_contact_imports
      where file_name='audience.csv' and created_at between '2026-11-22 05:00:00+00'::timestamptz and '2026-11-22 05:14:00+00'::timestamptz`;
    const [preserved] = await tx`select count(*)::integer as older_simulation_markers_preserved from public.mail_contacts
      where imported_at<${since}::timestamptz and lead_source ~ '^AUDIENCE UI SIMULATION [0-9a-f-]{36}$'`;
    const [evidence] = await tx`select public.mail_guided_setup_facts() as facts`;
    return { security, tables, fixtures, ...preserved, ...legacy, snapshotReadable: Boolean(evidence.facts?.contacts && Array.isArray(evidence.facts.domains)) };
  });
  console.log(JSON.stringify(result));
  if (!Object.values(result.security).every(Boolean) || !Object.values(result.tables).every(Boolean) || Object.values(result.fixtures).some(count => count !== 0)) process.exitCode = 1;
} catch (error) { console.error(JSON.stringify({ audit: "guided_setup", code: error.code ?? "connection", message: String(error.message).replace(/postgres(?:ql)?:\/\/\S+/g, "[redacted]") })); process.exitCode = 1; }
finally { await sql.end(); }
