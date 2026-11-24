// Existing direct PostgreSQL fallback: CLI OAuth/MCP are unavailable here.
// Creates only the private opt-in wrapper; never modifies contact records.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
const require = createRequire(resolve("apps/worker/package.json"));
const environment = { ...parseEnv(readFileSync(".env", "utf8")), ...process.env };
if (!environment.DATABASE_URL) throw new Error("DATABASE_URL is required");
const sql = require("postgres")(environment.DATABASE_URL, { max: 1, connect_timeout: 15, onnotice: () => {} });
try {
  const [before] = await sql`select (select count(*) from public.mail_contacts) contacts,(select count(*) from public.mail_suppressions) suppressions,(select count(*) from public.mail_contact_consents) consents`;
  await sql.unsafe(readFileSync("supabase/migrations/20261122061255_contact_existing_opt_in.sql", "utf8"));
  const [access] = await sql`select not prosecdef as security_invoker,
    not has_function_privilege('anon',oid,'execute') as anon_denied,
    not has_function_privilege('authenticated',oid,'execute') as authenticated_denied,
    has_function_privilege('service_role',oid,'execute') as service_allowed
    from pg_proc where oid='public.mail_contact_add_opted_in(jsonb)'::regprocedure`;
  const [after] = await sql`select (select count(*) from public.mail_contacts) contacts,(select count(*) from public.mail_suppressions) suppressions,(select count(*) from public.mail_contact_consents) consents`;
  assert.ok(Object.values(access).every(Boolean)); assert.deepEqual(after, before);
  console.log(JSON.stringify({ migration: "contact_existing_opt_in", ...access, dataPreserved: true }));
} catch (error) {
  console.error(JSON.stringify({ migration: "contact_existing_opt_in", code: error.code ?? "connection", message: String(error.message).replace(/postgres(?:ql)?:\/\/\S+/g, "[redacted]") })); process.exitCode = 1;
} finally { await sql.end(); }
