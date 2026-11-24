import type { Campaign, Overview } from "./types";

export function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function campaignDates(campaign: Campaign) {
  return [
    { at: campaign.created_at, label: "campaign created" },
    { at: campaign.started_at, label: "sending started" },
    { at: campaign.started_at ? campaign.completed_at : null, label: "sending finished" },
  ].filter((event): event is { at: string; label: string } => Boolean(event.at) && !Number.isNaN(new Date(event.at!).getTime()));
}

export function performance(data: Overview | null) {
  const delivered = data?.totals.delivered ?? null;
  const accepted = data?.totals.accepted ?? null;
  const opened = data?.totals.opened_delivered ?? null;
  return { delivered, accepted, openRate: delivered && opened !== null ? opened / delivered * 100 : null, sending: data?.totals.sending_campaigns ?? null };
}

export function nextAction(data: Overview | null) {
  if (!data) return { heading: "Campaign data unavailable.", text: "Use Refresh to reload your dashboard." };
  const failed = data.campaigns.filter(row => ["failed", "partially_failed"].includes(row.status)).length;
  if (failed) return { heading: `${failed} recent campaign${failed === 1 ? " needs" : "s need"} attention.`, text: "Open Campaign History to review recipient failures." };
  const sending = data.totals.sending_campaigns ?? 0;
  if (sending) return { heading: `${sending} campaign${sending === 1 ? " is" : "s are"} sending.`, text: "Open Active Sending to monitor recipient outcomes." };
  if (!data.sending?.configured) return { heading: "Set up email sending.", text: "Open Email Setup to connect Resend and add your sender." };
  if (!data.totals.contacts) return { heading: "Add your first recipients.", text: "Open Contacts to add recipients with marketing consent." };
  if (!data.totals.campaigns) return { heading: "Ready to create a campaign?", text: "Choose Create campaign to open the visual builder." };
  return { heading: "Review your campaign results.", text: "Open Recipient Activity for deliveries, opens, clicks and failures." };
}
