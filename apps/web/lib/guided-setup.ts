export type SetupState = "not_started" | "in_progress" | "complete" | "needs_attention" | "unable_to_verify";
export type SetupId = "connection" | "domain" | "sender" | "tracking" | "contacts" | "campaign" | "launch";
export type GuidePage = "Overview" | "Email Setup" | "Contacts" | "Compose & Send" | "Active Sending" | "Campaign History" | "Recipient Activity" | "Suppressions" | "Settings";
export type GuideAction = { page: GuidePage; target?: string; campaignId?: string };
export type SetupStep = { id: SetupId; state: SetupState; reason: string; action: GuideAction };
export type ReadinessCheck = { id: string; label: string; state: SetupState; reason: string; action: GuideAction };
export type SetupSnapshot = {
  version: 1; checked_at: string; verification: "verified" | "partial" | "unavailable";
  steps: SetupStep[]; completed: number; current: SetupId | null; complete: boolean;
  readiness: { ready: boolean; draft_name: string | null; checks: ReadinessCheck[]; tracking: SetupState };
};
export const setupDefinitions: Record<SetupId, { title: string; description: string; button: string; action: GuideAction }> = {
  connection: { title: "Connect your email provider", description: "Connect your Resend account to start sending emails.", button: "Connect Resend", action: { page: "Email Setup", target: "setup-connection" } },
  domain: { title: "Verify your sending domain", description: "Send emails from your own domain instead of a test address.", button: "Configure domain", action: { page: "Email Setup", target: "setup-domain" } },
  sender: { title: "Set up your sending identity", description: "Choose the name and email address your recipients will see.", button: "Configure sender", action: { page: "Email Setup", target: "setup-sender" } },
  tracking: { title: "Track your email activity", description: "Set up delivery, open and click tracking.", button: "Set up tracking", action: { page: "Email Setup", target: "setup-tracking" } },
  contacts: { title: "Build your audience", description: "Add contacts individually or import a CSV.", button: "Manage contacts", action: { page: "Contacts", target: "audience-contacts" } },
  campaign: { title: "Build your first campaign", description: "Choose recipients, create your email and prepare it for sending.", button: "Create campaign", action: { page: "Compose & Send" } },
  launch: { title: "Launch your first campaign", description: "Preview your email, send a test and launch when ready.", button: "Review campaign", action: { page: "Compose & Send" } },
};
export const setupOrder = Object.keys(setupDefinitions) as SetupId[];
export const stateLabel: Record<SetupState, string> = { not_started: "Not started", in_progress: "In progress", complete: "Complete", needs_attention: "Needs attention", unable_to_verify: "Unable to verify" };
export type SetupEvidence = {
  connection: null | { configured: boolean; validated: boolean; failed: boolean; webhookConfigured: boolean; webhookReceived: boolean };
  facts: null | {
    domains: { id: string; domain: string; verified: boolean; manual: boolean; tracking: boolean; failed: boolean }[];
    identities: { from_email: string; domain_id: string; valid: boolean; tested: boolean; is_default: boolean }[];
    contacts: { total: number; eligible: number };
    draft: null | { id: string; name: string; from_email: string; content_valid: boolean; audience_configured: boolean; audience_verified: boolean; eligible: number; excluded: number; approved: boolean };
    submitted: boolean; prepared_campaign?: boolean; configuration_truncated?: boolean;
  };
};

/** Pure evidence reducer; local preferences and test messages never count as campaign sends. */
export function deriveSetup(evidence: SetupEvidence, dispatch: { send: boolean; reason: string }, now = new Date().toISOString()): SetupSnapshot {
  const { connection: c, facts: f } = evidence;
  const steps: SetupStep[] = setupOrder.map(id => ({ id, state: "unable_to_verify", reason: "Status could not be verified. Retry the setup check; existing configuration has not been changed.", action: setupDefinitions[id].action }));
  const set = (id: SetupId, state: SetupState, reason: string) => Object.assign(steps.find(step => step.id === id)!, { state, reason });
  if (c) {
    set("connection", !c.configured ? "not_started" : c.failed ? "needs_attention" : c.validated ? "complete" : "in_progress", !c.configured ? "Add your Resend API key in Email Setup. Saving it does not validate access or send email." : c.failed ? "The last validation failed. Review the saved key and domain permissions, then explicitly send one test." : c.validated ? "Resend accepted an explicit test using the current credential. Acceptance is not delivery." : "Key saved, but access is not validated. Configure a sender, then explicitly send a test in Tracking & testing.");
    set("tracking", c.webhookConfigured ? "in_progress" : "not_started", c.webhookConfigured ? c.webhookReceived ? "A signed event was received. Domain open/click settings still need verification." : "Signing secret saved. Add the endpoint and email events in Resend Webhooks, then wait for a verified signed event." : "Add the webhook endpoint in Resend, choose email events, then save its signing secret here. Never paste the secret into a help message.");
  }
  if (f) {
    const verifiedDomains = f.domains.filter(domain => domain.verified && domain.domain !== "resend.dev");
    const validSenders = f.identities.filter(identity => identity.valid && verifiedDomains.some(domain => domain.id === identity.domain_id && identity.from_email.split("@")[1] === domain.domain));
    const sender = validSenders.find(identity => identity.is_default) ?? validSenders[0];
    if (c) {
      set("domain", verifiedDomains.length ? "complete" : f.domains.some(domain => domain.failed) ? "needs_attention" : f.domains.length ? "in_progress" : "not_started", verifiedDomains.length ? "Your exact sending domain has current provider verification evidence." : f.domains.some(domain => domain.manual) ? "Manual linking is not DNS proof. Verify this exact domain in Resend. With Full Access, import it and refresh status here; a sending test alone cannot verify DNS." : f.domains.length ? "Compare the exact DNS records with your DNS provider, keep existing website/mail records, then request verification and refresh status." : "Link your owned domain. Enter example.com, not support@example.com or a website URL. With Sending Access, verify it in Resend first.");
      set("sender", sender ? "complete" : f.identities.length ? "needs_attention" : "not_started", sender ? `${sender.from_email} is saved with the required company details and an exact, provider-verified domain.` : f.identities.length ? "Review the saved sender's exact From domain and required footer details. Refresh domain verification; edit the existing identity instead of adding it twice." : "Save a display name, matching From address, company name and mailing address. Reply-To is optional and may use another domain.");
      const trackingVerified = Boolean(c.webhookConfigured && c.webhookReceived && sender && verifiedDomains.some(domain => domain.id === sender.domain_id && domain.tracking));
      set("tracking", trackingVerified ? "complete" : c.webhookConfigured ? "in_progress" : "not_started", trackingVerified ? "Signed webhook evidence received; open and click tracking are enabled for the sender's domain. Privacy tools and scanners can affect engagement counts." : c.webhookConfigured ? "Webhook secret configured. Receive a signed email event and confirm opens/clicks are enabled for your sender's domain. An explicit test may generate events; it is not a campaign launch." : "Copy the endpoint from Tracking & testing into Resend Webhooks. Select delivery, engagement, bounce and complaint events, then save the signing secret.");
      if (f.configuration_truncated) for (const id of ["domain", "sender", "tracking"] as const) if (steps.find(step => step.id === id)!.state !== "complete") set(id, "unable_to_verify", "This installation has more configuration records than the bounded setup check can inspect. Review Email Setup; ask your administrator to inspect the remaining records. No missing configuration is being assumed.");
    }
    set("contacts", f.contacts.eligible > 0 ? "complete" : f.contacts.total > 0 ? "needs_attention" : "not_started", f.contacts.eligible > 0 ? `${f.contacts.eligible.toLocaleString()} eligible contact${f.contacts.eligible === 1 ? "" : "s"}. Consent and suppressions must be rechecked for each real send.` : f.contacts.total ? "Contacts exist, but none are eligible. Open a contact to review consent evidence, archived status and suppressions. Never invent consent or remove a suppression to pass setup." : "Add a contact or import a CSV. Map columns, fix invalid rows and record genuine consent before selecting recipients.");
    const d = f.draft;
    const validDraft = Boolean(d?.content_valid && d.audience_configured && d.audience_verified && d.eligible > 0 && f.identities.some(identity => identity.valid && identity.from_email === d.from_email));
    set("campaign", validDraft || f.prepared_campaign ? "complete" : d ? d.audience_verified ? "in_progress" : "unable_to_verify" : "not_started", validDraft ? `“${d!.name}” is saved with content, a configured sender and eligible recipients. It has not been sent.` : f.prepared_campaign ? "An existing campaign has saved valid content and real recipient queue records. Review Campaign History for its status." : d ? "Open the saved draft. Check Campaign Start, Audience and Email; save valid content and recheck eligible recipients. An unsaved canvas does not complete this step." : "Create a campaign in visual or standard mode. Save its name, sender, audience, subject and email content.");
    for (const id of ["campaign", "launch"] as const) if (d) steps.find(step => step.id === id)!.action = { page: "Compose & Send", campaignId: d.id };
    if (!d && f.prepared_campaign) for (const id of ["campaign", "launch"] as const) steps.find(step => step.id === id)!.action = { page: "Campaign History" };
    set("launch", f.submitted ? "complete" : !dispatch.send ? "needs_attention" : d ? "in_progress" : "not_started", f.submitted ? "A campaign has persisted recipient queue records. Single-recipient test messages do not count." : "Preview your saved draft, send an explicit test, review current eligible/excluded recipients and approve the audience before final confirmation.");
  }
  if (!f && c) set("tracking", "unable_to_verify", "Tracking configuration was loaded, but domain tracking evidence could not be checked. Retry setup status; do not replace saved credentials just to refresh it.");
  const step = (id: SetupId) => steps.find(row => row.id === id)!;
  const d = f?.draft;
  const checks: ReadinessCheck[] = ["connection", "domain", "sender"].map(id => ({ ...step(id as SetupId), label: setupDefinitions[id as SetupId].title }));
  // Global setup can use any saved identity; readiness must match this exact draft.
  if (f && c && d) {
    const draftSender = f.identities.find(identity => identity.from_email === d.from_email);
    const draftDomain = f.domains.find(domain => domain.id === draftSender?.domain_id && domain.domain === d.from_email.split("@")[1]);
    for (const id of ["domain", "sender"]) {
      const check = checks.find(row => row.id === id)!;
      const valid = Boolean(draftDomain?.verified && draftDomain.domain !== "resend.dev" && (id === "domain" || draftSender?.valid));
      check.state = valid ? "complete" : f.configuration_truncated ? "unable_to_verify" : "needs_attention";
      check.reason = valid ? `Current evidence matches the saved draft's From address: ${d.from_email}.` : "The saved draft's From address needs its own valid identity and exact provider-verified domain. A different sender's approval does not cover this draft.";
    }
  }
  checks.push({ id: "content", label: "Saved campaign content", state: !f ? "unable_to_verify" : d?.content_valid ? "complete" : "not_started", reason: "The saved name, subject and email body must be present. Unsaved edits are not checked.", action: step("campaign").action });
  for (const [id, label] of [["audience", "Eligible audience"], ["consent", "Consent & suppressions"]]) checks.push({ id, label, state: !f || d && !d.audience_verified ? "unable_to_verify" : d && d.eligible > 0 ? "complete" : "not_started", reason: d?.audience_verified ? `${d.eligible} currently eligible; ${d.excluded} excluded. This preview is not permission to send. The sending engine must recheck every recipient.` : "Select an audience and refresh its eligibility in the builder. Missing consent, archived and suppressed contacts must stay excluded.", action: step("campaign").action });
  checks.push({ id: "approval", label: "Audience approval", state: !f ? "unable_to_verify" : d?.approved ? "complete" : "not_started", reason: "Approve the current saved draft's audience in the builder. Changing the draft or recipient eligibility invalidates approval.", action: step("campaign").action });
  checks.push({ id: "test", label: "Explicit sender test", state: !f || !c ? "unable_to_verify" : d && f.identities.some(identity => identity.from_email === d.from_email && identity.tested) ? "complete" : "not_started", reason: "In Email Setup → Tracking & testing, explicitly send one test from the draft's sender. A test is not a campaign send or proof of delivery.", action: { page: "Email Setup", target: "setup-tracking" } });
  checks.push({ id: "dispatch", label: "Campaign dispatch", state: dispatch.send ? "complete" : "needs_attention", reason: dispatch.reason, action: { page: "Active Sending" } });
  let recommended = steps.find(row => row.state !== "complete");
  if (recommended?.id === "connection" && c?.configured && !c.validated && !c.failed && f) {
    // Validation needs a sender first. Do not trap users in a "save key again" loop.
    const prerequisite = steps.find(row => ["domain", "sender"].includes(row.id) && row.state !== "complete");
    if (prerequisite) recommended = prerequisite;
    else { step("connection").action = { page: "Email Setup", target: "setup-tracking" }; checks.find(check => check.id === "connection")!.action = step("connection").action; }
  }
  return { version: 1, checked_at: now, verification: c && f ? "verified" : c || f ? "partial" : "unavailable", steps, completed: steps.filter(row => row.state === "complete").length, current: recommended?.id ?? null, complete: steps.every(row => row.state === "complete"), readiness: { ready: checks.every(check => check.state === "complete"), draft_name: d?.name ?? null, checks, tracking: step("tracking").state } };
}
