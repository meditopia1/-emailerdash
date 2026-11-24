import fs from "node:fs";
const env = Object.fromEntries(fs.readFileSync(".env", "utf8").split(/\r?\n/).filter(line => line && !line.startsWith("#") && line.includes("=")).map(line => { const i = line.indexOf("="); return [line.slice(0, i), line.slice(i + 1).replace(/^['\"]|['\"]$/g, "")]; }));
try {
  const response = await fetch("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` }, signal: AbortSignal.timeout(15000) });
  const payload = await response.json().catch(() => null);
  console.log(JSON.stringify({ status: response.status, ok: response.ok, domains: Array.isArray(payload?.data) ? payload.data.map(row => ({ name: row.name, status: row.status })) : null, message: payload?.message ?? null }));
} catch (error) { console.log(JSON.stringify({ name: error?.name ?? "Error", message: error?.message ?? "Unknown error", cause: error?.cause?.code ?? null })); }
