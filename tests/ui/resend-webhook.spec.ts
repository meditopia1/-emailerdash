import { expect, test } from "@playwright/test";
import { createHmac, createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { decryptSecret } from "../../apps/web/lib/crypto";

const configuration = parseEnv(readFileSync(resolve("apps/web/.env.local"), "utf8"));
const require = createRequire(resolve("apps/worker/package.json"));
const postgres = require("postgres");

test("signed HTTP webhooks persist only associated fixtures, deduplicate and reject invalid signatures", async ({ request }) => {
  test.setTimeout(90000);
  const sql = postgres(configuration.DATABASE_URL, { max: 1, connect_timeout: 15, onnotice: () => {} });
  const run = randomUUID(); const campaignId = randomUUID(); const recipientId = randomUUID(); const messageId = `mock-http-${run}`;
  const email = `resend-webhook-${run}@example.com`; const placeholder = `WEBHOOK SIMULATION ${run}`;
  let settingsCreated = false; let originalHealth: string | null = null; let simulatedHealth: string | null = null;
  const invalidId = `invalid-${run}`; const invalidSignature = "v1,invalid";
  const auditHash = createHash("sha256").update(`${invalidId}.${invalidSignature}`).digest("hex");
  try {
    const created = await sql`insert into public.mail_settings(id,sender_name,from_email,company_name,physical_address) values(true,${placeholder},'','Simulation','Simulation') on conflict do nothing returning id`;
    settingsCreated = created.length === 1;
    const [settings] = await sql`select webhook_secret_ciphertext,last_webhook_at from public.mail_settings where id`;
    originalHealth = settings.last_webhook_at;
    const signingSecret = settings.webhook_secret_ciphertext ? decryptSecret(settings.webhook_secret_ciphertext, configuration.ENCRYPTION_MASTER_KEY) : configuration.RESEND_WEBHOOK_SIGNING_SECRET;
    expect(Boolean(signingSecret)).toBe(true);
    await sql`insert into public.mail_campaigns(id,name,sender_name,from_email,subject,content_text,status,total_count) values(${campaignId},${placeholder},'Simulation','hello@example.com','Simulation','Simulation','completed',1)`;
    await sql`insert into public.mail_recipients(id,campaign_id,email,status,provider_message_id) values(${recipientId},${campaignId},${email},'accepted',${messageId})`;
    const send = async (kind: string, suffix: string, providerMessageId = messageId) => {
      const id = `${run}-${suffix}`; const timestamp = String(Math.floor(Date.now()/1000));
      const payload = JSON.stringify({ type: `email.${kind}`, created_at: new Date().toISOString(), data: { email_id: providerMessageId, campaign_id: randomUUID(), to: ["untrusted-payload@example.com"] } });
      const signature = createHmac("sha256", Buffer.from(signingSecret.slice(6), "base64")).update(`${id}.${timestamp}.${payload}`).digest("base64");
      return request.post("/api/webhooks/resend/default", { data: payload, headers: { "content-type": "application/json", "svix-id": id, "svix-timestamp": timestamp, "svix-signature": `v1,${signature}` } });
    };
    expect((await send("sent", "sent")).status()).toBe(200);
    expect((await sql`select accepted_count,delivered_count from public.mail_campaigns where id=${campaignId}`)[0]).toMatchObject({ accepted_count: 1, delivered_count: 0 });
    expect((await send("delivered", "delivered")).status()).toBe(200);
    expect((await send("opened", "opened-1")).status()).toBe(200);
    const duplicate = await send("opened", "opened-1"); expect(duplicate.status()).toBe(200); expect((await duplicate.json()).outcome).toBe("duplicate");
    expect((await send("opened", "opened-2")).status()).toBe(200);
    expect((await send("clicked", "clicked")).status()).toBe(200);
    const [metrics] = await sql`select accepted_count,delivered_count,opened_count,clicked_count from public.mail_campaigns where id=${campaignId}`;
    expect(metrics).toEqual({ accepted_count: 1, delivered_count: 1, opened_count: 1, clicked_count: 1 });
    const [association] = await sql`select email,campaign_id,recipient_id from public.mail_events where provider_event_id=${`${run}-opened-1`}`;
    expect(association).toEqual({ email, campaign_id: campaignId, recipient_id: recipientId });
    expect((await send("opened", "unknown", `unrelated-${run}`)).status()).toBe(503);
    const rejected = await request.post("/api/webhooks/resend/default", { data: "{}", headers: { "svix-id": invalidId, "svix-timestamp": String(Math.floor(Date.now()/1000)), "svix-signature": invalidSignature } });
    expect(rejected.status()).toBe(401);
    expect((await request.post("/api/webhooks/resend/not-our-connection", { data: "{}" })).status()).toBe(404);
    expect((await send("bounced", "bounced")).status()).toBe(200);
    expect((await sql`select reason from public.mail_suppressions where normalized_email=${email}`)[0].reason).toBe("bounced");
    simulatedHealth = (await sql`select last_webhook_at from public.mail_settings where id`)[0].last_webhook_at;
  } finally {
    // Only exact fixture IDs. Never truncate, delete users, replace keys, or reset user data.
    await sql`delete from public.mail_events where campaign_id=${campaignId}`;
    await sql`delete from public.mail_campaigns where id=${campaignId}`;
    await sql`delete from public.mail_suppressions where normalized_email=${email}`;
    await sql`delete from public.mail_integration_audit where entity_id=${auditHash}`;
    if (settingsCreated) await sql`delete from public.mail_settings where id and sender_name=${placeholder}`;
    else if (simulatedHealth) await sql`update public.mail_settings set last_webhook_at=${originalHealth} where id and last_webhook_at=${simulatedHealth}`;
    await sql.end();
  }
});

test("sender APIs enforce exact domains, preserve credentials and create drafts without queuing", async ({ request }) => {
  test.setTimeout(90000);
  const sql = postgres(configuration.DATABASE_URL, { max: 1, connect_timeout: 15, onnotice: () => {} });
  const run = randomUUID(); const domainId = randomUUID(); const prefix = `RESEND SENDER SIMULATION ${run}`;
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now()/1000)+3600, nonce: run })).toString("base64url");
  const cookie = `${payload}.${createHmac("sha256", configuration.ADMIN_SESSION_SECRET).update(payload).digest("base64url")}`;
  const headers = { cookie: `marketing_os_admin=${cookie}`, origin: "http://localhost:3001" };
  let createdSettings = false; let senderId: string | null = null;
  try {
    const inserted = await sql`insert into public.mail_settings(id,sender_name,from_email,company_name,physical_address) values(true,${prefix},'','Simulation','Simulation') on conflict do nothing returning id`;
    createdSettings = inserted.length === 1;
    const [before] = await sql`select resend_api_key_ciphertext,webhook_secret_ciphertext,from_email,credential_version from public.mail_settings where id`;
    const domain = `updates-${run}.example.com`;
    await sql`insert into public.mail_sending_domains(id,domain) values(${domainId},${domain})`;
    const identity = { domain_id: domainId, sender_name: "Sender Simulation", from_email: `hello@${domain}`, reply_to: "support@example.com", company_name: "Simulation", physical_address: "Simulation address" };
    expect((await request.put("/api/dashboard/settings", { headers, data: { ...identity, from_email: "hello@example.com" } })).status()).toBe(400);
    expect((await request.put("/api/dashboard/settings", { headers, data: { ...identity, reply_to: "invalid-mailbox" } })).status()).toBe(400);
    const saved = await request.put("/api/dashboard/settings", { headers, data: identity }); expect(saved.status()).toBe(200); senderId = (await saved.json()).id;
    const [after] = await sql`select resend_api_key_ciphertext,webhook_secret_ciphertext,from_email,credential_version from public.mail_settings where id`;
    expect(before.resend_api_key_ciphertext === after.resend_api_key_ciphertext).toBe(true);
    expect(before.webhook_secret_ciphertext === after.webhook_secret_ciphertext).toBe(true);
    expect(before.from_email === after.from_email).toBe(true);
    const draft = { name: prefix, subject: "Simulation", content_text: "Simulation only", from_email: identity.from_email, audience_contact_ids: [] };
    const campaign = await request.post("/api/dashboard/campaigns", { headers, data: draft }); expect(campaign.status()).toBe(201);
    const record = await campaign.json(); expect(record.from_email).toBe(identity.from_email); expect(record.sender_name).toBe(identity.sender_name);
    expect((await sql`select count(*)::integer n from public.mail_recipients where campaign_id=${record.id}`)[0].n).toBe(0);
    expect((await request.post("/api/dashboard/campaigns", { headers, data: { ...draft, from_email: "unapproved@unrelated.example.com" } })).status()).toBe(400);
    expect((await sql`select verification_status from public.mail_sending_domains where id=${domainId}`)[0].verification_status).toBe("self_reported");
  } finally {
    await sql`delete from public.mail_campaigns where name=${prefix}`;
    if (senderId) await sql`delete from public.mail_integration_audit where entity_id=${senderId}`;
    await sql`delete from public.mail_sending_domains where id=${domainId}`;
    if (createdSettings) await sql`delete from public.mail_settings where id and sender_name=${prefix}`;
    await sql.end();
  }
});
