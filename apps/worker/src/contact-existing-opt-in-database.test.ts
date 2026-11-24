import { expect, it } from "vitest";
import postgres from "postgres";
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { randomUUID } from "node:crypto";
const environment = { ...(existsSync("../../.env") ? parseEnv(readFileSync("../../.env", "utf8")) : {}), ...process.env };
const rollback = new Error("CONTACT_DECLARATION_ROLLBACK");

it.runIf(Boolean(environment.DATABASE_URL))("prior opt-in uses database time and cannot bypass duplicates, withdrawals or suppression; fixtures roll back", async () => {
  const sql = postgres(environment.DATABASE_URL!, { max: 1, connect_timeout: 15, onnotice: () => {} });
  const id = randomUUID(), blocked = randomUUID(), email = `declaration-${id}@example.com`, blockedEmail = `blocked-${id}@example.com`;
  const payload = { id, email, first_name: "Test", last_name: "", phone: "", company: "", job_title: "", lifecycle_status: "prospect", lead_source: "test", notes: "", tags: [], list_ids: [], custom_fields: {} };
  try {
    await sql.begin(async tx => {
      const [rights] = await tx`select has_function_privilege('anon','public.mail_contact_add_opted_in(jsonb)','execute') anon,has_function_privilege('authenticated','public.mail_contact_add_opted_in(jsonb)','execute') authenticated,has_function_privilege('service_role','public.mail_contact_add_opted_in(jsonb)','execute') service`;
      expect(rights).toEqual({ anon: false, authenticated: false, service: true });
      // Deliberately untrusted future input: stored time must come from Postgres.
      await tx`select public.mail_contact_add_opted_in(${tx.json({ ...payload, consent: { at: "2999-01-01T00:00:00Z" } })})`;
      const [saved] = await tx`select c.consent_status,c.consent_method,c.consented_at=now() as database_time,a.eligible from public.mail_contacts c join public.mail_contact_audience a on a.id=c.id where c.id=${id}`;
      expect(saved).toEqual({ consent_status: "granted", consent_method: "administrator_attestation", database_time: true, eligible: true });
      const [ledger] = await tx`select count(*)::int count,min(evidence) evidence from public.mail_contact_consents where contact_id=${id}`;
      expect(ledger.count).toBe(1); expect(ledger.evidence).toContain("not the original opt-in date");
      await tx`select public.mail_contact_save(${tx.json({ ...payload, company: "Edited" })},${id})`;
      const [afterEdit] = await tx`select count(*)::int count from public.mail_contact_consents where contact_id=${id}`;
      expect(afterEdit.count).toBe(1);
      await tx`insert into public.mail_suppressions(normalized_email,reason,source) values(${email},'unsubscribed','declaration rollback test'),(${blockedEmail},'complaint','declaration rollback test')`;
      await expect(tx.savepoint(sp => sp`select public.mail_contact_add_opted_in(${sp.json({ ...payload, id: randomUUID() })})`)).rejects.toMatchObject({ code: "23505" });
      await expect(tx.savepoint(sp => sp`select public.mail_contact_add_opted_in(${sp.json({ ...payload, id: blocked, email: blockedEmail })})`)).rejects.toThrow(/suppressed/i);
      const [unchanged] = await tx`select c.consent_status,a.eligible from public.mail_contacts c join public.mail_contact_audience a on a.id=c.id where c.id=${id}`;
      expect(unchanged).toEqual({ consent_status: "unsubscribed", eligible: false });
      const [notCreated] = await tx`select exists(select 1 from public.mail_contacts where id=${blocked}) as found`; expect(notCreated.found).toBe(false);
      throw rollback;
    });
  } catch (error) { if (error !== rollback) throw error; }
  finally {
    const [left] = await sql`select exists(select 1 from public.mail_contacts where id in (${id},${blocked})) or exists(select 1 from public.mail_suppressions where normalized_email in (${email},${blockedEmail})) as fixtures_left`;
    expect(left.fixtures_left).toBe(false); await sql.end();
  }
}, 60000);
