import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { createHmac } from "node:crypto";

const read = path => { try { return parseEnv(readFileSync(resolve(path), "utf8")); } catch { return {}; } };
const root = read(".env");
const local = read("apps/web/.env.local");
const env = { ...root, ...local };
console.log(JSON.stringify({ node: process.version, systemCA: process.execArgv.includes("--use-system-ca"), configurationMatches: ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ADMIN_SESSION_SECRET"].every(key => !root[key] || !local[key] || root[key] === local[key]) }));

async function check(label, url, headers) {
  const start = Date.now();
  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(18000) });
    const body = await response.json().catch(() => ({}));
    console.log(JSON.stringify({ label, status: response.status, milliseconds: Date.now() - start, ...(typeof body.code === "string" ? { code: body.code } : {}), ...(typeof body.error === "string" ? { error: body.error } : {}) }));
  } catch (error) { console.log(JSON.stringify({ label, milliseconds: Date.now() - start, error: error.name, cause: error.cause?.code ?? null })); }
}

const headers = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` };
await Promise.all(["mail_settings", "mail_sender_identities", "mail_campaigns"].map(table => check(`database:${table}`, `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${table}?select=id&limit=1`, headers)));
const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 300, nonce: "read-only-diagnostics" })).toString("base64url");
const signature = createHmac("sha256", env.ADMIN_SESSION_SECRET).update(payload).digest("base64url");
await Promise.all(["overview", "settings/resend"].map(path => check(`app:${path}`, `http://localhost:3000/api/dashboard/${path}`, { cookie: `marketing_os_admin=${payload}.${signature}` })));
