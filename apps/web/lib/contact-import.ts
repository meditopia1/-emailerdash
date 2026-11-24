import { contactInputSchema, validateCustomValues, type ContactInput, type CustomField } from "./audience-schema";

export const importTargets = ["email", "first_name", "last_name", "phone", "company", "job_title", "lifecycle_status", "lead_source", "notes", "consent_status", "consent_method", "consent_source", "consent_at", "consent_evidence"];
export function csvCell(value: unknown) { let text = value == null ? "" : Array.isArray(value) ? value.join("; ") : String(value); if (/^[\s]*[=+@-]|^[\t\r\n]/.test(text)) text = `'${text}`; return `"${text.replaceAll('"', '""')}"`; }
export type CsvFile = { headers: string[]; rows: string[][] };
/** Bounded RFC-style CSV parser; quoted newlines and escaped quotes remain intact. */
export function parseContactCsv(source: string): CsvFile {
  if (source.length > 10 * 1024 * 1024) throw new Error("Choose a CSV no larger than 10 MB.");
  const rows: string[][] = []; let row: string[] = []; let field = ""; let quoted = false; let closed = false;
  const input = source.replace(/^\uFEFF/, "");
  const finish = () => { row.push(field); if (row.some(value => value.trim())) rows.push(row); row = []; field = ""; closed = false; if (rows.length > 100001) throw new Error("Use at most 100,000 rows per import."); };
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (char === '"') { if (quoted && input[index + 1] === '"') { field += '"'; index++; } else if (quoted) { quoted = false; closed = true; } else if (!field && !closed) quoted = true; else throw new Error("Unexpected quote. Export the file as a standard comma-separated CSV."); }
    else if (char === "," && !quoted) { row.push(field); field = ""; closed = false; }
    else if ((char === "\n" || char === "\r") && !quoted) { if (char === "\r" && input[index + 1] === "\n") index++; finish(); }
    else { if (closed && !/\s/.test(char)) throw new Error("Unexpected text after a quoted CSV field."); field += char; }
    if (field.length > 10000 || row.length > 100) throw new Error("Use at most 100 columns and 10,000 characters per CSV cell.");
  }
  if (quoted) throw new Error("A quoted CSV field was not closed."); finish();
  const headers = rows.shift()?.map(value => value.trim()) ?? [];
  if (!headers.length || !rows.length) throw new Error("Include a header row and at least one contact.");
  if (headers.length > 100 || headers.some(value => !value || value.length > 200) || new Set(headers).size !== headers.length) throw new Error("Use distinct, non-empty column headings (up to 100 columns).");
  return { headers, rows };
}
export function guessMapping(headers: string[], fields: CustomField[]) {
  const aliases: Record<string, string> = { "email address": "email", "client email": "email", "e-mail": "email", "first name": "first_name", "last name": "last_name", "organisation": "company", "organization": "company", "company name": "company", "job title": "job_title", "phone number": "phone", "source": "lead_source" };
  const mapping: Record<string, string> = {}; const used = new Set<string>();
  headers.forEach((header, index) => { const lower = header.toLowerCase(); const target = aliases[lower] ?? (importTargets.includes(lower) ? lower : fields.find(field => field.name.toLowerCase() === lower || field.key === lower)?.id); if (target && !used.has(target)) { mapping[String(index)] = target; used.add(target); } });
  return mapping;
}
export function mappedImportRow(row: string[], mapping: Record<string, string>, fields: CustomField[]) {
  const values: Record<string, unknown> = {}; const custom: ContactInput["custom_fields"] = {};
  for (const [column, target] of Object.entries(mapping)) {
    if (!target) continue; const raw = (row[Number(column)] ?? "").trim();
    const field = fields.find(item => item.id === target);
    if (field) { if (!raw) continue; custom[field.id] = field.type === "number" ? Number(raw) : field.type === "boolean" ? /^(true|yes|1)$/i.test(raw) ? true : /^(false|no|0)$/i.test(raw) ? false : raw : field.type === "multi_select" ? raw.split(";").map(item => item.trim()).filter(Boolean) : raw; }
    else values[target] = raw;
  }
  const consent = values.consent_status ? { status: String(values.consent_status).toLowerCase(), method: values.consent_method ?? "", source: values.consent_source ?? "", at: values.consent_at ? new Date(String(values.consent_at)).toISOString() : null, evidence: values.consent_evidence ?? "" } : undefined;
  for (const key of ["consent_status", "consent_method", "consent_source", "consent_at", "consent_evidence"]) delete values[key];
  const parsed = contactInputSchema.parse({ ...values, custom_fields: custom, ...(consent ? { consent } : {}) });
  validateCustomValues(parsed.custom_fields, fields);
  // Existing-record updates use only mapped values. Defaults must not erase unmapped profile fields.
  const supplied = new Set(Object.values(mapping)); const output: Record<string, unknown> = { email: parsed.email, custom_fields: parsed.custom_fields };
  for (const [key, value] of Object.entries(parsed)) if (supplied.has(key)) output[key] = value;
  if (consent) output.consent = parsed.consent;
  return { complete: parsed, supplied: output };
}
export type ImportJob = { id: string; file_name: string; fingerprint: string; total_rows: number; status: string; mode: "skip" | "update"; tags: string[]; list_id: string | null; staged_count: number; processed_count: number; imported_count: number; updated_count: number; skipped_count: number; invalid_count: number; duplicate_count: number; failed_count: number; last_error: string | null; created_at: string; updated_at: string; mapping: Record<string, string> };
