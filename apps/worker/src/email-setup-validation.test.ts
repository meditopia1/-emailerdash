import { describe, expect, it } from "vitest";
import { domainName, domainNextStep, identitySchema, senderAddressIssue } from "../../web/lib/email-setup-validation";

describe("actionable email setup validation", () => {
  it.each(["support@day1main.com", "https://day1main.com/settings"])("helps move %s into the correct field", value => {
    const parsed = domainName.safeParse(value);
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues[0].message).toContain("Enter just day1main.com");
  });
  it("accepts normalized domains but keeps the Resend test domain separate", () => {
    expect(domainName.parse(" DAY1MAIN.COM ")).toBe("day1main.com");
    const parsed = domainName.safeParse("resend.dev");
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues[0].message).toContain("Resend test sender");
  });
  it.each(["hello@other.example", "hello@updates.day1main.com", "day1main.com", "https://day1main.com", ""])("explains a matching From address for %s", address => {
    expect(senderAddressIssue(address, "day1main.com")).toContain("support@day1main.com");
  });
  it("keeps exact-domain checks, including parent/subdomain isolation", () => {
    expect(senderAddressIssue(" SUPPORT@DAY1MAIN.COM ", "day1main.com")).toBeNull();
    expect(senderAddressIssue("support@day1main.com", "updates.day1main.com")).toContain("@updates.day1main.com");
  });
  it("gives field-specific help and permits a separate Reply-to domain", () => {
    const valid = { domain_id: "00000000-0000-4000-8000-000000000001", sender_name: "Example team", from_email: "support@day1main.com", reply_to: "replies@other.example", company_name: "Example", physical_address: "123 Example Lane, Singapore" };
    expect(identitySchema.safeParse(valid).success).toBe(true);
    for (const [field, guidance] of [["from_email", "From address"], ["reply_to", "Reply-to address"], ["physical_address", "mailing address"], ["company_name", "email footer"]]) {
      const parsed = identitySchema.safeParse({ ...valid, [field]: field === "reply_to" ? "invalid" : "" });
      expect(parsed.success).toBe(false);
      if (!parsed.success) expect(parsed.error.issues.find(issue => issue.path[0] === field)?.message).toContain(guidance);
    }
  });
  it("directs a verified domain to sender setup, not unnecessary DNS changes", () => {
    expect(domainNextStep("verified", "day1main.com")).toContain("already verified");
    expect(domainNextStep("verified", "day1main.com")).toContain("No DNS changes");
    expect(domainNextStep("pending", "day1main.com")).toContain("add any missing records");
  });
});
