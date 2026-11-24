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
  await sql.unsafe(readFileSync("supabase/migrations/0005_campaign_visual_builder.sql", "utf8"));
  const columns = await sql`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'mail_campaigns' and column_name in ('audience_contact_ids','revision','workflow_layout','layout_revision')`;
  if (columns.length !== 4) throw new Error("Migration verification failed");
  console.log("Builder migration applied. Existing tables, campaigns, and RLS preserved.");
} catch (error) {
  console.error("Builder migration failed:", error.code ?? "database error");
  process.exitCode = 1;
} finally { await sql.end(); }
