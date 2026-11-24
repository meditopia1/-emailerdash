import { expect, it } from "vitest";
import postgres from "postgres";
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { randomUUID } from "node:crypto";
const environment = { ...(existsSync("../../.env") ? parseEnv(readFileSync("../../.env", "utf8")) : {}), ...process.env };
const rollback = new Error("GUIDED_SETUP_ROLLBACK");
it.runIf(Boolean(environment.DATABASE_URL))("private setup facts reflect persisted eligibility and queue evidence; fixtures roll back", async () => {
  const sql = postgres(environment.DATABASE_URL!, { max: 1, connect_timeout: 15, onnotice: () => {} });
  const id = randomUUID(); const domain = `guided-${id}.example.com`; const email = `eligible-${id}@example.com`; const contact = randomUUID(); const blocked = randomUUID(); const campaign = randomUUID();
  try {
    await sql.begin(async tx => {
      await tx`set local statement_timeout='15s'`;
      const [before] = await tx`select public.mail_guided_setup_facts() as facts`;
      const [rights] = await tx`select has_function_privilege('anon','public.mail_guided_setup_facts()','execute') anon,has_function_privilege('authenticated','public.mail_guided_setup_facts()','execute') authenticated,has_function_privilege('service_role','public.mail_guided_setup_facts()','execute') service`;
      expect(rights).toEqual({ anon: false, authenticated: false, service: true });
      await tx`insert into public.mail_settings(id) values(true) on conflict(id) do nothing`;
      const [senderDomain] = await tx`insert into public.mail_sending_domains(domain) values(${domain}) returning id`;
      await tx`insert into public.mail_sender_identities(domain_id,sender_name,from_email,company_name,physical_address) values(${senderDomain.id},'Guide fixture',${'hello@' + domain},'Guide fixture','Fixture city and country')`;
      await tx`insert into public.mail_contacts(id,email,consent_source,consented_at,consent_status) values(${contact},${email},'automated test',now(),'granted'),(${blocked},${'blocked-' + email},'automated test',now(),'granted')`;
      await tx`insert into public.mail_suppressions(normalized_email,reason,source) values(${'blocked-' + email},'manual','guided setup test')`;
      await tx`insert into public.mail_campaigns(id,name,sender_name,from_email,subject,content_text,audience_contact_ids,created_at) values(${campaign},'Guided setup fixture','Guide fixture',${'hello@' + domain},'Fixture subject','Fixture email',${[contact, blocked]},now()+interval '1 minute')`;
      const [saved] = await tx`select public.mail_guided_setup_facts() as facts`;
      expect(saved.facts.draft).toMatchObject({ id: campaign, content_valid: true, audience_configured: true, audience_verified: true, eligible: 1, excluded: 1, approved: false });
      expect(saved.facts.contacts.eligible).toBe(Number(before.facts.contacts.eligible) + 1);
      expect(saved.facts.submitted).toBe(before.facts.submitted);
      expect(JSON.stringify(saved.facts)).not.toContain("Fixture email");
      expect(JSON.stringify(saved.facts)).not.toContain("ciphertext");
      await tx`update public.mail_campaigns set status='queued' where id=${campaign}`;
      const [statusOnly] = await tx`select public.mail_guided_setup_facts() as facts`;
      expect(statusOnly.facts.submitted).toBe(before.facts.submitted);
      await tx`insert into public.mail_recipients(campaign_id,contact_id,email) values(${campaign},${contact},${email})`;
      const [queued] = await tx`select public.mail_guided_setup_facts() as facts`;
      expect(queued.facts.submitted).toBe(true);
      throw rollback;
    });
  } catch (error) { if (error !== rollback) throw error; }
  finally { const [left] = await sql`select exists(select 1 from public.mail_campaigns where id=${campaign}) or exists(select 1 from public.mail_contacts where id in (${contact},${blocked})) as fixtures_left`; expect(left.fixtures_left).toBe(false); await sql.end(); }
}, 60000);
