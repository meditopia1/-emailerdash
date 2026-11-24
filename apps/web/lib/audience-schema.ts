import { z } from "zod";

export const consentStatuses = ["unknown", "granted", "denied", "revoked", "unsubscribed"] as const;
export const lifecycleStatuses = ["prospect", "lead", "customer", "inactive"] as const;
export const fieldTypes = ["text", "number", "date", "boolean", "single_select", "multi_select"] as const;
export type FilterRule = { field: string; op: string; value?: string | number | boolean };
export type FilterGroup = { join: "and" | "or"; conditions: FilterNode[] };
export type FilterNode = FilterRule | FilterGroup;
export const emptyFilter: FilterGroup = { join: "and", conditions: [] };
export const filterFields = ["name", "email", "company", "job_title", "phone", "lifecycle_status", "consent_status", "lead_source", "imported_at", "last_contacted_at", "last_opened_at", "last_clicked_at", "campaign_count", "tags", "list", "eligible", "archived"];
const scalar = z.union([z.string().max(500), z.number().finite(), z.boolean()]);
const rule = z.object({ field: z.string().refine(value => filterFields.includes(value) || /^custom\.[0-9a-f-]{36}$/i.test(value), "Choose a supported filter field."), op: z.enum(["eq", "neq", "contains", "is_empty", "is_not_empty", "before", "after", "within_days", "gt", "lt"]), value: scalar.optional() }).strict();
const nodeSchema: z.ZodType<FilterNode> = z.lazy(() => z.union([rule, z.object({ join: z.enum(["and", "or"]), conditions: z.array(nodeSchema).max(20) }).strict()]));
export const filterSchema = nodeSchema.superRefine((node, context) => {
  let count = 0;
  function visit(item: FilterNode, depth: number) {
    count++;
    if (depth > 3 || count > 30) { context.addIssue({ code: "custom", message: "Use at most 30 filter conditions and three nested groups." }); return; }
    if ("conditions" in item) item.conditions.forEach(child => visit(child, depth + 1));
    else if (!["is_empty", "is_not_empty"].includes(item.op) && item.value === undefined) context.addIssue({ code: "custom", message: "Add a value for each filter condition." });
  }
  visit(node, 0);
});
const text = (max: number) => z.string().trim().max(max).optional().default("");
export const consentSchema = z.object({ status: z.enum(consentStatuses), method: text(100), source: text(500), at: z.string().datetime({ offset: true }).nullable().optional().default(null), evidence: text(2000) }).strict().superRefine((value, context) => {
  if (value.status === "granted" && (!value.method || !value.source || !value.evidence || !value.at || new Date(value.at).getTime() > Date.now() || /^(csv|import|upload|manual)$/i.test(value.source))) context.addIssue({ code: "custom", path: ["evidence"], message: "Granted consent needs a method, original permission source, past timestamp and evidence/reference. CSV import alone is not permission." });
});
export const customValueSchema = z.union([z.string().max(2000), z.number().finite(), z.boolean(), z.array(z.string().max(100)).max(30), z.null()]);
export const contactInputSchema = z.object({
  id: z.string().uuid().optional(), email: z.string().trim().toLowerCase().email().max(320),
  first_name: text(100), last_name: text(100), phone: z.string().trim().max(40).regex(/^[+\d\s().x-]*$/, "Use a phone number, including its country code where available.").optional().default(""), company: text(200), job_title: text(200),
  lifecycle_status: z.enum(lifecycleStatuses).optional().default("prospect"), lead_source: text(200), notes: text(5000),
  tags: z.array(z.string().trim().min(1).max(50)).max(20).optional().default([]), list_ids: z.array(z.string().uuid()).max(20).optional().default([]),
  custom_fields: z.record(z.string().uuid(), customValueSchema).refine(value => Object.keys(value).length <= 50).optional().default({}),
  consent: consentSchema.optional(),
}).strict();
// POST only: an explicit operator declaration of prior opt-in. Database time is
// authoritative; no original signup timestamp or evidence is invented.
export const contactCreateInputSchema = contactInputSchema.extend({ existing_opt_in: z.literal(true).optional() }).superRefine((value, context) => {
  if (value.existing_opt_in && value.consent) context.addIssue({ code: "custom", path: ["consent"], message: "Use either the existing opt-in declaration or a consent record, not both." });
});
export const resourceSchema = z.object({
  kind: z.enum(["segment", "list", "field"]), id: z.string().uuid().optional(), name: z.string().trim().min(1).max(100), description: text(500),
  filter: filterSchema.optional(), type: z.enum(fieldTypes).optional(), key: z.string().regex(/^[a-z][a-z0-9_]{0,49}$/).optional(), options: z.array(z.string().trim().min(1).max(100)).max(30).optional().default([]),
}).strict();
export const selectionSchema = z.object({ type: z.enum(["contacts", "segment", "list", "filter"]), ids: z.array(z.string().uuid()).max(1000).optional(), id: z.string().uuid().optional(), filter: filterSchema.optional(), search: z.string().max(200).optional() }).strict().superRefine((value, context) => {
  if (["segment", "list"].includes(value.type) && !value.id) context.addIssue({ code: "custom", message: "Choose a saved audience." });
  if (value.type === "filter" && !value.filter) context.addIssue({ code: "custom", message: "Define an audience filter." });
});
export type AudienceSelection = z.infer<typeof selectionSchema>;
export type ContactInput = z.infer<typeof contactInputSchema>;
export type CustomField = { id: string; name: string; key: string; type: typeof fieldTypes[number]; options: string[] };
export type AudienceContact = {
  id: string; email: string; name: string | null; first_name: string; last_name: string; phone: string; company: string; job_title: string; lifecycle_status: string; lead_source: string; notes?: string;
  consent_status: string; consent_source: string | null; consented_at: string | null; imported_at: string; updated_at: string; archived_at: string | null;
  tags: string[]; list_ids: string[]; custom_fields: Record<string, z.infer<typeof customValueSchema>>;
  eligible: boolean; reason: string | null; suppression_reason: string | null; last_contacted_at: string | null; last_opened_at: string | null; last_clicked_at: string | null; campaign_count: number;
};
export type AudienceResources = { fields: CustomField[]; tags: { id: string; name: string }[]; segments: { id: string; name: string; description: string; filter: FilterNode }[]; lists: { id: string; name: string; description: string; count: number }[] };
export type AudiencePage = { contacts: AudienceContact[]; count: number; page: number; page_size: number; metrics: { total: number; eligible: number; unsubscribed: number; suppressed: number }; resources: AudienceResources };

export function validateCustomValues(values: ContactInput["custom_fields"], fields: CustomField[]) {
  for (const [id, value] of Object.entries(values)) {
    const field = fields.find(item => item.id === id); if (!field) throw new z.ZodError([{ code: "custom", path: ["custom_fields", id], message: "A custom field no longer exists. Refresh the field definitions." }]);
    if (value === null || value === "") continue;
    const valid = field.type === "text" ? typeof value === "string" : field.type === "number" ? typeof value === "number" : field.type === "boolean" ? typeof value === "boolean" : field.type === "date" ? typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value : field.type === "single_select" ? typeof value === "string" && field.options.includes(value) : Array.isArray(value) && value.every(item => field.options.includes(item));
    if (!valid) throw new z.ZodError([{ code: "custom", path: ["custom_fields", id], message: `Check the value for ${field.name}; expected ${field.type.replaceAll("_", " ")}.` }]);
  }
}
