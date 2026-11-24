// CLI/MCP are preferred. This repository's established direct PostgreSQL fallback
// is used when CLI OAuth is unavailable; credentials never enter command arguments.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
const require = createRequire(resolve("apps/worker/package.json"));
const environment = { ...parseEnv(readFileSync(".env", "utf8")), ...process.env };
if (!environment.DATABASE_URL) throw new Error("DATABASE_URL is required");
const sql = require("postgres")(environment.DATABASE_URL, { max: 1, connect_timeout: 15, onnotice: () => {} });
try {
  const [before] = await sql`select (select count(*) from public.mail_contacts) contacts,(select count(*) from public.mail_campaigns) campaigns,(select count(*) from public.mail_recipients) recipients`;
  await sql.unsafe(readFileSync("supabase/migrations/20261122044203_guided_setup_facts.sql", "utf8"));
  const [security] = await sql`select not prosecdef as security_invoker,
    not has_function_privilege('anon',oid,'execute') as anon_denied,
    not has_function_privilege('authenticated',oid,'execute') as authenticated_denied,
    has_function_privilege('service_role',oid,'execute') as service_allowed
    from pg_proc where oid='public.mail_guided_setup_facts()'::regprocedure`;
  const [evidence] = await sql`select public.mail_guided_setup_facts() as facts`;
  const [after] = await sql`select (select count(*) from public.mail_contacts) contacts,(select count(*) from public.mail_campaigns) campaigns,(select count(*) from public.mail_recipients) recipients`;
  if (!Object.values(security).every(Boolean) || JSON.stringify(before) !== JSON.stringify(after)) throw new Error("Setup security or preservation check failed");
  console.log(JSON.stringify({ migration: "guided_setup_facts", ...security, dataPreserved: true, snapshotReadable: Boolean(evidence.facts?.contacts && Array.isArray(evidence.facts.domains)) }));
} catch (error) { console.error(JSON.stringify({ migration: "guided_setup_facts", code: error.code ?? "connection", message: String(error.message).replace(/postgres(?:ql)?:\/\/\S+/g, "[redacted]") })); process.exitCode = 1; }
finally { await sql.end(); }
