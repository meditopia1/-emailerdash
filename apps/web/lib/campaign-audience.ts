import { isEligibleRecipient, normalizeEmail } from "@marketing-os/email";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

export type AudienceRow = { id: string; email: string; name: string | null; consent_source: string | null; consented_at: string | null; consent_status?: string; archived_at?: string | null; eligible: boolean; reason: string | null; custom_fields?: Record<string, unknown> };
export function annotateAudienceContacts<T extends Omit<AudienceRow, "eligible" | "reason">>(contacts: T[], suppressed: Map<string, string>) {
  return contacts.map(contact => {
    const email = normalizeEmail(contact.email); const optedIn = Boolean(contact.consent_status === "granted" && !contact.archived_at && contact.consent_source?.trim() && contact.consented_at && new Date(contact.consented_at).getTime() <= Date.now());
    const isSuppressed = suppressed.has(email); const validEmail = z.string().email().max(320).safeParse(email).success;
    return { ...contact, email, eligible: validEmail && isEligibleRecipient({ email, optedIn, suppressed: isSuppressed }), reason: contact.archived_at ? "Archived" : !validEmail ? "Invalid email address" : isSuppressed ? `Suppressed: ${suppressed.get(email)}` : optedIn ? null : "Consent is missing or not granted" };
  });
}
export async function resolveCampaignAudience(db: SupabaseClient, contactIds: string[]) {
  const ids = [...new Set(contactIds)];
  if (!ids.length) return { rows: [] as AudienceRow[], selected: 0, eligible: 0, excluded: 0, missing: 0 };
  const contacts: Omit<AudienceRow, "eligible" | "reason">[] = [];
  for (let index = 0; index < ids.length; index += 100) {
    const { data, error } = await db.from("mail_contacts").select("id,email,name,consent_source,consented_at,consent_status,archived_at,custom_values:mail_contact_field_values(value,field:mail_contact_fields(key))").in("id", ids.slice(index, index + 100)).limit(100);
    if (error) throw new Error("Audience validation unavailable");
    contacts.push(...(data ?? []).map(({ custom_values, ...contact }) => ({ ...contact, custom_fields: Object.fromEntries((custom_values ?? []).map(value => [(value.field as unknown as { key: string }).key, value.value])) })));
  }
  const emails = contacts.map(contact => normalizeEmail(contact.email));
  const suppressed = new Map<string, string>();
  for (let index = 0; index < emails.length; index += 100) {
    const { data, error } = await db.from("mail_suppressions").select("normalized_email,reason").in("normalized_email", emails.slice(index, index + 100)).limit(100);
    if (error) throw new Error("Suppression validation unavailable");
    for (const row of data ?? []) suppressed.set(row.normalized_email, row.reason);
  }
  const rows: AudienceRow[] = annotateAudienceContacts(contacts, suppressed);
  const eligible = rows.filter(row => row.eligible).length; const missing = ids.length - rows.length;
  return { rows, selected: ids.length, eligible, excluded: ids.length - eligible, missing };
}
