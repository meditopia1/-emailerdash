import { expect, it } from "vitest";
import postgres from "postgres";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { randomUUID } from "node:crypto";

const path = resolve("../../.env");
const env = { ...(existsSync(path) ? parseEnv(readFileSync(path, "utf8")) : {}), ...process.env };
const rollback = new Error("ROLLBACK_TEST_FIXTURES");

it.runIf(Boolean(env.DATABASE_URL))("private integration: rotation, atomic defaults, rate limits, webhook dedup, unique metrics and suppressions", async () => {
  if (!env.DATABASE_URL) throw new Error("Configure DATABASE_URL before database integration checks.");
  const sql = postgres(env.DATABASE_URL, { max: 1, connect_timeout: 15, onnotice: () => {} });
  const campaignId = randomUUID(); const recipientId = randomUUID(); const testId = randomUUID(); const providerId = `mock-${randomUUID()}`;
  try {
    await sql.begin(async tx => {
      const rows = await tx`select relname,relrowsecurity,relforcerowsecurity from pg_class where relnamespace = 'public'::regnamespace and relname in ('mail_settings','mail_sending_domains','mail_sender_identities','mail_test_sends','mail_integration_audit','mail_integration_limits')`;
      expect(rows).toHaveLength(6); expect(rows.every(row => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
      const [rights] = await tx`select has_table_privilege('anon','public.mail_sending_domains','select') a,has_table_privilege('authenticated','public.mail_settings','select') b,has_function_privilege('authenticated','public.record_mail_provider_event(text,text,text,timestamp with time zone,jsonb)','execute') c`;
      expect(rights).toEqual({ a: false, b: false, c: false });
      await tx`select public.mail_integration_action('connect', ${tx.json({ ciphertext: "ENCRYPTED_TEST_ONLY", managed: false })})`;
      const [settings] = await tx`select credential_version, connection_state, managed_domains from public.mail_settings where id`;
      expect(settings.connection_state).toBe("configuration_saved"); expect(settings.managed_domains).toBe(false);
      const [domain] = await tx`insert into public.mail_sending_domains(domain) values(${`test-${randomUUID()}.example.com`}) returning id,domain,verification_status`;
      expect(domain.verification_status).toBe("self_reported");
      const from = `hello@${domain.domain}`;
      const [sender] = await tx`insert into public.mail_sender_identities(domain_id,sender_name,from_email,company_name,physical_address) values(${domain.id},'Integration Simulation',${from},'Simulation','Test address') returning id`;
      await tx`select public.mail_integration_action('default_domain',${tx.json({ id: domain.id })})`;
      await tx`select public.mail_integration_action('default_sender',${tx.json({ id: sender.id })})`;
      expect((await tx`select from_email from public.mail_settings where id`)[0].from_email).toBe(from);
      await tx`insert into public.mail_test_sends(id,sender_identity_id,credential_version,from_email,destination,content_hash) values(${testId},${sender.id},${settings.credential_version},${from},'operator@example.com','mock-hash')`;
      await tx`select public.finish_mail_test(${testId},'accepted',${`test-email-${testId}`},null)`;
      const [validated] = await tx`select s.connection_state,i.tested_credential_version,d.verification_status from public.mail_settings s cross join public.mail_sender_identities i join public.mail_sending_domains d on d.id = i.domain_id where i.id = ${sender.id}`;
      expect(validated.connection_state).toBe("connection_validated"); expect(validated.tested_credential_version).toBe(settings.credential_version); expect(validated.verification_status).toBe("self_reported");
      await tx`select public.mail_integration_action('connect',${tx.json({ ciphertext: "NEW_ENCRYPTED_TEST_ONLY", managed: true })})`;
      const [rotated] = await tx`select credential_version,connection_state from public.mail_settings where id`;
      expect(rotated.credential_version).not.toBe(settings.credential_version); expect(rotated.connection_state).toBe("configuration_saved");
      await tx`select public.finish_mail_test(${testId},'accepted',${`test-email-${testId}`},null)`;
      expect((await tx`select connection_state from public.mail_settings where id`)[0].connection_state).toBe("configuration_saved");
      const bucket = `simulation-${testId}`;
      expect((await tx`select public.mail_integration_rate_limit(${bucket},1,60) allowed`)[0].allowed).toBe(true);
      expect((await tx`select public.mail_integration_rate_limit(${bucket},1,60) allowed`)[0].allowed).toBe(false);
      await tx`insert into public.mail_campaigns(id,name,sender_name,from_email,subject,content_text,status,total_count) values(${campaignId},'RESEND TRANSACTION SIMULATION','Simulation',${from},'Test','Test','completed',1)`;
      await tx`insert into public.mail_recipients(id,campaign_id,email,status,provider_message_id) values(${recipientId},${campaignId},${`simulation-${testId}@example.com`},'accepted',${providerId})`;
      const record = async (kind: string, eventId: string, metadata = {}) => (await tx`select public.record_mail_provider_event(${eventId},${providerId},${kind},now(),${tx.json(metadata)}) result`)[0].result;
      expect((await tx`select public.record_mail_provider_event('unmatched','unknown-provider-message','opened',now(),'{}') result`)[0].result).toBe("unmatched");
      expect(await record("sent", `${testId}-sent`)).toBe("recorded");
      expect((await tx`select delivered_count from public.mail_campaigns where id=${campaignId}`)[0].delivered_count).toBe(0);
      await record("delivered", `${testId}-delivered`);
      expect(await record("opened", `${testId}-open1`)).toBe("recorded"); expect(await record("opened", `${testId}-open1`)).toBe("duplicate");
      await record("opened", `${testId}-open2`); await record("clicked", `${testId}-click1`); await record("clicked", `${testId}-click2`);
      await record("sent", `${testId}-late-sent`);
      const [metrics] = await tx`select accepted_count,delivered_count,opened_count,clicked_count from public.mail_campaigns where id=${campaignId}`;
      expect(metrics).toEqual({ accepted_count: 1, delivered_count: 1, opened_count: 1, clicked_count: 1 });
      expect((await tx`select status from public.mail_recipients where id=${recipientId}`)[0].status).toBe("clicked");
      expect((await tx`select count(*)::integer n from public.mail_events where recipient_id=${recipientId} and event_type='opened'`)[0].n).toBe(2);
      await record("bounced", `${testId}-bounce`, { bounce_type: "Permanent" });
      expect((await tx`select reason from public.mail_suppressions where normalized_email=${`simulation-${testId}@example.com`}`)[0].reason).toBe("bounced");
      await record("complained", `${testId}-complaint`);
      expect((await tx`select status from public.mail_recipients where id=${recipientId}`)[0].status).toBe("blocked");
      await record("delivery_delayed", `${testId}-delay`);
      expect((await tx`select status from public.mail_recipients where id=${recipientId}`)[0].status).toBe("blocked");
      await tx`select public.mail_integration_action('disconnect','{}')`;
      expect((await tx`select connection_disabled,managed_domains from public.mail_settings where id`)[0]).toEqual({ connection_disabled: true, managed_domains: false });
      await tx`update public.mail_settings set connection_disabled=false,environment_credential_fingerprint=null where id`;
      await tx`select public.sync_mail_environment_credential('mock-environment-fingerprint-one')`;
      const [firstEnvironment] = await tx`select credential_version from public.mail_settings where id`;
      await tx`select public.sync_mail_environment_credential('mock-environment-fingerprint-one')`;
      expect((await tx`select credential_version from public.mail_settings where id`)[0].credential_version).toBe(firstEnvironment.credential_version);
      await tx`select public.sync_mail_environment_credential('mock-environment-fingerprint-two')`;
      expect((await tx`select credential_version from public.mail_settings where id`)[0].credential_version).not.toBe(firstEnvironment.credential_version);
      await tx`select public.mail_integration_action('remove_domain',${tx.json({ id: domain.id })})`;
      expect((await tx`select name,from_email from public.mail_campaigns where id=${campaignId}`)[0].from_email).toBe(from);
      throw rollback;
    });
  } catch (error) { if (error !== rollback) throw error; }
  finally { await sql.end(); }
}, 60000);
