import { describe, expect, it } from "vitest";
import { contactInputSchema, consentSchema, filterSchema, validateCustomValues, type CustomField } from "../../web/lib/audience-schema";
import { csvCell, guessMapping, mappedImportRow, parseContactCsv } from "../../web/lib/contact-import";
const field: CustomField = { id: "00000000-0000-4000-8000-000000000001", key: "interest", name: "Interest", type: "single_select", options: ["Health", "Software"] };
describe("audience validation", () => {
  it("never grants permission by default", () => { expect(contactInputSchema.parse({ email: "HELLO@example.com " }).consent).toBeUndefined(); });
  it("requires original evidence for granted consent", () => {
    expect(consentSchema.safeParse({ status: "granted", source: "CSV" }).success).toBe(false);
    expect(consentSchema.safeParse({ status: "granted", method: "opt-in", source: "Website form", evidence: "reference", at: "2999-01-01T00:00:00Z" }).success).toBe(false);
    expect(consentSchema.safeParse({ status: "granted", method: "opt-in", source: "Website form", evidence: "reference", at: "2025-01-01T00:00:00Z" }).success).toBe(true);
  });
  it("rejects unknown profile keys and invalid emails", () => { expect(contactInputSchema.safeParse({ email: "x", optedIn: true }).success).toBe(false); });
  it("validates nested filters without accepting SQL fragments", () => {
    expect(filterSchema.safeParse({ join: "and", conditions: [{ field: "company", op: "eq", value: "Day1Health" }, { join: "or", conditions: [{ field: "tags", op: "eq", value: "Newsletter" }] }] }).success).toBe(true);
    expect(filterSchema.safeParse({ field: "email);drop table users", op: "eq", value: "x" }).success).toBe(false);
    expect(filterSchema.safeParse({ field: "email", op: "eq" }).success).toBe(false);
  });
  it("bounds filter nesting and condition counts", () => { let nested: unknown = { field: "email", op: "eq", value: "x" }; for (let depth = 0; depth < 5; depth++) nested = { join: "and", conditions: [nested] }; expect(filterSchema.safeParse(nested).success).toBe(false); });
  it("validates configured custom select, multi-select and date values", () => {
    expect(() => validateCustomValues({ [field.id]: "Health" }, [field])).not.toThrow();
    expect(() => validateCustomValues({ [field.id]: "Other" }, [field])).toThrow();
    expect(() => validateCustomValues({ [field.id]: ["Health"] }, [{ ...field, type: "multi_select" }])).not.toThrow();
    expect(() => validateCustomValues({ [field.id]: "2026-02-31" }, [{ ...field, type: "date" }])).toThrow();
    expect(() => validateCustomValues({ [field.id]: "2026-02-28" }, [{ ...field, type: "date" }])).not.toThrow();
  });
  it("identifies invalid custom values as field errors, not storage failures", () => {
    expect.assertions(1);
    try { validateCustomValues({ [field.id]: "Not configured" }, [field]); }
    catch (error) { expect(error).toMatchObject({ issues: [{ path: ["custom_fields", field.id], message: "Check the value for Interest; expected single select." }] }); }
  });
});
describe("contact CSV mapping", () => {
  it("escapes spreadsheet formulas and quotes without changing stored data", () => { expect(csvCell("=HYPERLINK(1)")).toBe('"\'=HYPERLINK(1)"'); expect(csvCell('A "quoted" name')).toBe('"A ""quoted"" name"'); expect(csvCell(["A", "B"])).toBe('"A; B"'); });
  it("handles BOM, quoted commas, escaped quotes and newlines", () => { const parsed = parseContactCsv('\uFEFFEmail,First Name,Company\r\na@example.com,"A, B","Acme ""Labs"""\r\nb@example.com,"Two\nLines",Company'); expect(parsed.rows).toHaveLength(2); expect(parsed.rows[0][2]).toBe('Acme "Labs"'); expect(parsed.rows[1][1]).toBe("Two\nLines"); });
  it("rejects malformed CSV and ambiguous headings", () => { expect(() => parseContactCsv('Email,Email\na@b.com,a@b.com')).toThrow("distinct"); expect(() => parseContactCsv('Email,Name\na@b.com,"Unclosed')).toThrow("not closed"); expect(() => parseContactCsv('Email,Name\na@b.com,"A"x')).toThrow("Unexpected"); });
  it("guesses mapped headers and configured fields", () => { expect(guessMapping(["Client Email", "Organisation", "Interest"], [field])).toEqual({ "0": "email", "1": "company", "2": field.id }); });
  it("retains only supplied fields when updating existing rows", () => { const row = mappedImportRow(["Person@Example.com", "Day1Health"], { "0": "email", "1": "company" }, []); expect(row.complete.phone).toBe(""); expect(row.supplied.phone).toBeUndefined(); expect(row.supplied.company).toBe("Day1Health"); expect(row.complete.consent).toBeUndefined(); });
  it("rejects invalid consent and custom formats before staging", () => { expect(() => mappedImportRow(["a@example.com", "granted", "CSV"], { "0": "email", "1": "consent_status", "2": "consent_source" }, [])).toThrow(); expect(() => mappedImportRow(["a@example.com", "Other"], { "0": "email", "1": field.id }, [field])).toThrow(); });
  it("normalizes addresses without silently deduplicating or overwriting rows", () => { const parsed = parseContactCsv("Email\nPerson@Example.com\nperson@example.com"); expect(parsed.rows).toHaveLength(2); expect(mappedImportRow(parsed.rows[0], { "0": "email" }, []).complete.email).toBe("person@example.com"); });
});
