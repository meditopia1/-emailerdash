import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
const require = createRequire(resolve("apps/worker/package.json"));
const environment = { ...parseEnv(readFileSync(".env", "utf8")), ...process.env };
if (!environment.DATABASE_URL) throw new Error("DATABASE_URL is required");
const sql = require("postgres")(environment.DATABASE_URL, { max: 1, connect_timeout: 15, onnotice: () => {} });
try {
  const [before] = await sql`select (select count(*)::integer from public.mail_contacts) contacts,(select count(*)::integer from public.mail_campaigns) campaigns`;
  const [installed] = await sql`select to_regprocedure('public.mail_audience_query(jsonb)') is not null as installed`;
  if (!installed.installed) await sql.unsafe(readFileSync("supabase/migrations/0007_audience_management.sql", "utf8"));
  if (installed.installed && process.argv.includes("--refresh-functions")) {
    for (const path of ["supabase/migrations/0007_audience_management.sql", "supabase/migrations/0008_audience_approval.sql"]) {
      const source = readFileSync(path, "utf8");
      for (const definition of source.matchAll(/create function public\.[\s\S]*?\$\$;/g)) await sql.unsafe(definition[0].replace("create function", "create or replace function"));
      const view = source.match(/create view public\.mail_contact_audience[\s\S]*?;/); if (view) await sql.unsafe(view[0].replace("create view", "create or replace view"));
      for (const index of source.matchAll(/create (?:unique )?index [\s\S]*?;/g)) await sql.unsafe(index[0].replace(/create (unique )?index /, "create $1index if not exists "));
    }
  }
  const [approvals] = await sql`select to_regprocedure('public.mail_preview_campaign_audience(jsonb,uuid[])') is not null as installed`;
  if (!approvals.installed) await sql.unsafe(readFileSync("supabase/migrations/0008_audience_approval.sql", "utf8"));
  const [profile] = await sql`select to_regprocedure('public.mail_contact_profile(uuid,integer)') is not null as installed`;
  if (!profile.installed) await sql.unsafe(readFileSync("supabase/migrations/0009_contact_profile_read.sql", "utf8"));
  const [dashboard] = await sql`select to_regprocedure('public.mail_dashboard_snapshot(boolean)') is not null as installed`;
  if (!dashboard.installed) await sql.unsafe(readFileSync("supabase/migrations/0010_dashboard_read.sql", "utf8"));
  const [after] = await sql`select (select count(*)::integer from public.mail_contacts) contacts,(select count(*)::integer from public.mail_campaigns) campaigns`;
  const [security] = await sql`select count(*)::integer tables,bool_and(c.relrowsecurity and c.relforcerowsecurity) forced_rls from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname like 'mail_%'`;
  console.log(JSON.stringify({ migration: "0007_audience_management", alreadyInstalled: installed.installed, countsPreserved: before.contacts === after.contacts && before.campaigns === after.campaigns, ...security }));
} catch (error) { console.error(JSON.stringify({ migration: "0007_audience_management", code: error.code ?? "connection", message: String(error.message).replace(/postgres(?:ql)?:\/\/\S+/g, "[redacted]") })); process.exitCode = 1; }
finally { await sql.end(); }
