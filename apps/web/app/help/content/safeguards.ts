import type { HelpArticle } from "./types";
export const articles: HelpArticle[] = [{ id: "suppressions", title: "Review sending safeguards", description: "Suppressed addresses stay excluded from future sends.", page: "Suppressions", prerequisites: [], destination: { page: "Suppressions" }, instructions: [
  { title: "Find an address", text: "Use the dashboard search and page controls to review actual suppression records. This list is read-only; it does not remove sending restrictions." },
  { title: "Understand the reason", text: "Unsubscribes, complaints and hard bounces can block sending. Review the recorded reason and source, then inspect the related contact or recipient activity if needed." },
  { title: "Keep consent and history intact", text: "Importing the address again or editing its profile must not bypass a suppression. Do not delete a suppression simply to make a campaign eligible. Real sending must recheck both consent and suppression state." },
] }];
