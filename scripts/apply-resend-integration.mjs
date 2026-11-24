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
  const existing = await sql`select tablename, rowsecurity from pg_tables where schemaname = 'public' and tablename like 'mail_%' order by tablename`;
  console.log("Existing private mail tables:", existing.map(row => `${row.tablename}:RLS=${row.rowsecurity}`).join(", "));
  await sql.unsafe(readFileSync("supabase/migrations/0006_resend_integration.sql", "utf8"));
  console.log("Resend integration migration applied. No existing data removed. No provider operations performed.");
} catch (error) {
  console.error("Resend migration failed:", error.code ?? "database error", error.message?.replace(/postgres(?:ql)?:\/\/\S+/g, "[redacted]"));
  process.exitCode = 1;
} finally { await sql.end(); }
