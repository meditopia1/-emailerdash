import type { Page } from "@playwright/test";
import type { Overview } from "../../apps/web/app/dashboard/types";
export const mockResources = { fields: [], tags: [], segments: [], lists: [] };
export function contactPage(data: Overview) {
  const contacts = data.contacts.map(contact => ({ ...contact, first_name: contact.name ?? "", last_name: "", phone: "", company: "", job_title: "", tags: [], lifecycle_status: "prospect", consent_status: contact.consent_source && contact.consented_at ? "granted" : "unknown", lead_source: "", archived_at: null, updated_at: contact.imported_at, last_contacted_at: null, last_opened_at: null, last_clicked_at: null, campaign_count: 0, custom_fields: {}, list_ids: [], suppression_reason: contact.reason?.startsWith("Suppressed: ") ? contact.reason.slice(12) : null, eligible: contact.eligible ?? false, reason: contact.reason ?? null }));
  return { contacts, count: contacts.length, page: 0, page_size: 25, resources: mockResources, metrics: { total: data.totals.contacts ?? contacts.length, eligible: contacts.filter(contact => contact.eligible).length, unsubscribed: 0, suppressed: data.totals.suppressed ?? 0 } };
}
export async function mockAudienceData(page: Page, data: Overview) {
  await page.route("**/api/dashboard/contacts?*", route => route.fulfill({ json: contactPage(data) }));
  await page.route("**/api/dashboard/contacts/*", route => {
    if (route.request().method() !== "GET") return route.fallback();
    const id = new URL(route.request().url()).pathname.split("/").at(-1);
    if (id === "resources") return route.fulfill({ json: mockResources });
    const contact = contactPage(data).contacts[0] ?? { id, email: "new@example.com", name: "New contact", first_name: "New", last_name: "contact", company: "", phone: "", job_title: "", tags: [], list_ids: [], lifecycle_status: "prospect", lead_source: "", consent_status: "unknown", eligible: false, reason: "Consent is missing or not granted", imported_at: new Date().toISOString(), custom_fields: {} };
    return route.fulfill({ json: { contact: { ...contact, id, notes: "", consent_method: "", consent_evidence: "" }, events: [], consents: [], history: [], more: { events: false, consents: false, history: false } } });
  });
}
