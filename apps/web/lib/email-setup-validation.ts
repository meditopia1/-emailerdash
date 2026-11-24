import { z } from "zod";

const domainPattern = /^(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export function domainEntryHelp(value: string) {
  const input = value.trim().toLowerCase();
  const emailDomain = input.split("@");
  if (emailDomain.length === 2 && domainPattern.test(emailDomain[1])) return `Enter just ${emailDomain[1]} in Sending domain. Add the full email address separately in Your sending identity → From address.`;
  try {
    const url = new URL(input);
    if (["http:", "https:"].includes(url.protocol) && domainPattern.test(url.hostname)) return `Enter just ${url.hostname}. Leave out ${url.protocol}// and any page path; this field links a domain, not a website.`;
  } catch { /* Plain domain entry, not a URL. */ }
  return "Enter your domain only, for example example.com or updates.example.com. Leave out https://, page paths and the mailbox name before @.";
}

export const domainName = z.string().trim().toLowerCase().max(253, "Use a domain name of 253 characters or fewer, without a website path.").superRefine((value, context) => {
  if (!domainPattern.test(value)) context.addIssue({ code: z.ZodIssueCode.custom, message: domainEntryHelp(value) });
  else if (value === "resend.dev" || value.endsWith(".resend.dev")) context.addIssue({ code: z.ZodIssueCode.custom, message: "Use a custom domain you verified in Resend. To try onboarding@resend.dev without a custom domain, choose the explicit Resend test sender in Send test email." });
});
const mailAddress = (message: string) => z.string().trim().toLowerCase().email(message).max(320, "Use an email address of 320 characters or fewer.");
export const emailAddress = mailAddress("Enter a complete email address, for example support@example.com.");
export const identitySchema = z.object({
  domain_id: z.string().uuid("Choose a Sending domain from the list. If it is empty, link your domain in Sending domains above first."),
  sender_name: z.string().trim().min(1, "Add the name recipients should see, for example your company or team name.").max(200, "Shorten the sender display name to 200 characters or fewer.").regex(/^[^<>\x00-\x1F\x7F]+$/, "Use only your display name here, without <email addresses> or line breaks. Enter the email separately in From address."),
  from_email: mailAddress("Enter a complete From address, such as support@yourdomain.com. Use the selected Sending domain after @."),
  reply_to: mailAddress("Enter a complete Reply-to address, such as support@yourcompany.com, or leave it blank. It may use a different domain.").or(z.literal("")).optional(),
  company_name: z.string().trim().min(1, "Add the company name to include in your email footer.").max(200, "Shorten the company name to 200 characters or fewer."),
  physical_address: z.string().trim().min(1, "Add your company's physical mailing address for the email footer, including city and country.").max(1000, "Shorten the mailing address to 1,000 characters or fewer."),
}).strict();

export function senderAddressHelp(selectedDomain: string) {
  return `Use a complete address ending in @${selectedDomain}, for example support@${selectedDomain}. This is an example; enter an address you are authorized to use.`;
}
export function senderAddressIssue(address: string, selectedDomain: string) {
  if (!emailAddress.safeParse(address).success) return `Enter a complete From address, for example support@${selectedDomain}. A domain name or website URL alone will not work here.`;
  if (address.trim().toLowerCase().split("@")[1] !== selectedDomain.toLowerCase()) return `Your selected sending domain is ${selectedDomain}. Use a From address ending in @${selectedDomain}, such as support@${selectedDomain}, or select the configured domain that matches your address.`;
  return null;
}
export function domainNextStep(status: string, domain: string) {
  if (status === "verified") return `${domain} is already verified in Resend. Next: add a matching From address in Your sending identity, save it, then send a test email. No DNS changes or another verification request are needed for this step.`;
  if (["pending", "not_started", "partially_verified"].includes(status)) return `${domain} is not fully verified yet. Compare the exact DNS records below with your DNS provider, add any missing records, then request verification and refresh after propagation. Keep existing website and incoming-mail records.`;
  return `Resend reports ${status.replaceAll("_", " ")} for ${domain}. Open Resend Domains to review which DNS records need attention, correct those records, then refresh status here.`;
}
