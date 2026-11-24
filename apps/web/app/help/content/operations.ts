import type { HelpArticle } from "./types";
export const articles: HelpArticle[] = [
  { id: "history", title: "Review campaign history", description: "Saved drafts and real sending results, in one place.", page: "Campaign History", prerequisites: [], destination: { page: "Campaign History" }, instructions: [
    { title: "Find a campaign", text: "Search by campaign name and review its stored status. A saved draft has not been queued or sent. Campaign dates reflect actual creation and sending records, not a scheduling promise." },
    { title: "Open the right view", text: "Open Visual Builder resumes a draft or opens a read-only monitor for an existing sending/completed campaign. Campaign details show recipient and event counts from stored records." },
    { title: "Review outcomes", text: "Accepted and delivered are separate. Review unique opens, clicks and failures in the campaign monitor or Recipient Activity. Open and click counts can be affected by privacy tools and scanners." },
  ] },
  { id: "launch", title: "Review before a real launch", description: "A test message is not a queued campaign.", page: "Active Sending", prerequisites: ["Verified sending configuration and an explicitly tested sender.", "Saved content, eligible recipients and current audience approval.", "EMAIL_DRY_RUN=false on the persistent worker for real delivery."], destination: { page: "Active Sending" }, instructions: [
    { title: "Prepare without sending", text: "Save the draft, preview content, explicitly test one owned destination and review eligible/excluded recipients. No setup or help action submits a campaign." },
    { title: "Confirm worker mode", text: "The persistent worker claims recipient jobs, rechecks consent and suppressions, sends through Resend with an idempotency key, retries temporary failures and records final outcomes. Keep EMAIL_DRY_RUN=true for a non-sending rehearsal; use false only when the sender and webhook setup are ready." },
    { title: "Monitor real queue records", text: "Active Sending shows persisted queued and sending campaigns. A launch is only counted when a campaign actually has queued recipient records. History and Recipient Activity show subsequent results, not invented progress." },
  ] },
  { id: "activity", title: "Understand delivery and engagement", description: "Provider acceptance, delivery and engagement are distinct.", page: "Recipient Activity", prerequisites: ["Configured webhooks with signed event evidence."], destination: { page: "Recipient Activity" }, instructions: [
    { title: "Read the right event", text: "Accepted means Resend received the message. Delivered confirms arrival at the recipient mail server. It does not guarantee inbox placement. Open and click metrics represent unique recipients, not every repeated event." },
    { title: "Review failures safely", text: "Bounces and complaints can suppress future sending. Review the recipient and event details instead of retrying blindly. Use Sending safeguards for the read-only suppression list." },
    { title: "Missing events?", text: "Open Email Setup → Tracking & testing. Check the deployed endpoint, saved signing secret, event selection and domain tracking flags. Open and click counts can be affected by privacy tools and automated scanners." },
  ] },
  { id: "overview", title: "Find your next step", description: "Your command centre uses stored campaigns and actual event counts.", page: "Overview", prerequisites: [], destination: { page: "Overview" }, instructions: [
    { title: "Follow Getting Started", text: "The checklist uses saved configuration and database evidence, not clicked checkboxes. Unknown status means a check could not be verified; retry instead of re-entering existing setup." },
    { title: "Create and monitor", text: "Create a campaign opens the existing builder. Contacts manages your audience. Campaign History shows saved campaigns and Campaign activity uses actual creation and sending dates; it does not imply scheduling." },
    { title: "Keep help within reach", text: "Open Help from the sidebar on any page. Minimize the checklist whenever you like; it does not change technical readiness or hide critical sending blockers." },
  ] },
];
