import { describe, expect, it } from "vitest";
import { contactCreateInputSchema, contactInputSchema } from "../audience-schema";

describe("existing opt-in declaration", () => {
  it("accepts an explicit declaration without requesting original signup evidence", () => {
    const input = contactCreateInputSchema.parse({ email: "person@example.com", existing_opt_in: true });
    expect(input.existing_opt_in).toBe(true);
    expect(input.consent).toBeUndefined();
  });

  it("rejects conflicting consent inputs and non-boolean assertions", () => {
    expect(contactCreateInputSchema.safeParse({ email: "person@example.com", existing_opt_in: "true" }).success).toBe(false);
    expect(contactCreateInputSchema.safeParse({ email: "person@example.com", existing_opt_in: true, consent: { status: "unsubscribed" } }).success).toBe(false);
  });

  it("does not change shared API/import defaults or existing-contact edits", () => {
    expect(contactInputSchema.parse({ email: "person@example.com" }).consent).toBeUndefined();
    expect(contactCreateInputSchema.parse({ email: "person@example.com" }).consent).toBeUndefined();
    expect(contactInputSchema.safeParse({ email: "person@example.com", existing_opt_in: true }).success).toBe(false);
  });
});
