"use client";
import { Icon } from "./icons";
import { formatNumber, statusLabel, type Campaign, type MailEvent } from "./types";

export function sendingProgress(campaign: Campaign): number | null {
  const count = campaign.recipient_count; const processed = campaign.processed_count;
  return typeof count === "number" && count > 0 && typeof processed === "number" && processed >= 0 && processed <= count ? processed / count * 100 : null;
}
const number = (value: number | null | undefined) => typeof value === "number" ? formatNumber(value) : "—";
const date = (value?: string | null) => value ? new Date(value).toLocaleString() : "—";
export function CampaignTable({ campaigns, sending = false, updatedAt, onSelect, onOpen }: { campaigns: Campaign[]; sending?: boolean; updatedAt: Date | null; onSelect: (campaign: Campaign) => void; onOpen: (id: string) => void }) {
  return <>{sending && <div className="data-state-note" role="status">Live mode · refreshes every 3 seconds. <button className="builder-list-action" onClick={() => window.dispatchEvent(new Event("dashboard-refresh"))}>Refresh now</button></div>}<div className="os-table-scroll"><table className="os-table"><thead><tr><th scope="col">Campaign</th><th scope="col">Status</th>{sending ? <><th scope="col">Queued recipients</th><th scope="col">Messages processed</th><th scope="col">Accepted messages</th><th scope="col">Failed messages</th><th scope="col">Sending progress</th><th scope="col" title="Latest successful data refresh">Last updated</th></> : <><th scope="col">Recipients</th><th scope="col">Date created</th><th scope="col">Date sent</th><th scope="col">Delivered</th><th scope="col">Opened</th><th scope="col">Clicked</th></>}<th scope="col"><span className="sr-only">Details</span></th></tr></thead><tbody>{campaigns.map(campaign => {
    const progress = sendingProgress(campaign);
    return <tr key={campaign.id}><td><button className="campaign-name-button" onClick={() => onSelect(campaign)}><span className="round-icon accent"><Icon name="mail" size={18} /></span>{campaign.name}</button></td><td><span className="status-pill">{statusLabel(campaign.status)}</span></td>{sending ? <><td>{number(campaign.queued_count)}</td><td>{number(campaign.processed_count)}</td><td>{number(campaign.accepted_count)}</td><td>{number(campaign.failed_count)}</td><td>{progress === null ? "—" : `${progress.toFixed(0)}%`}</td><td>{updatedAt?.toLocaleString() ?? "—"}</td></> : <><td>{number(campaign.total_count)}</td><td>{date(campaign.created_at)}</td><td>{["completed", "partially_failed"].includes(campaign.status) ? date(campaign.completed_at) : "—"}</td><td>{number(campaign.delivered_count)}</td><td>{number(campaign.opened_count)}</td><td>{number(campaign.clicked_count)}</td></>}<td><div className="campaign-row-actions"><button className="builder-list-action" onClick={() => onOpen(campaign.id)}>Open Visual Builder</button><button className="icon-button-os" aria-label={`View ${campaign.name}`} onClick={() => onSelect(campaign)}><Icon name="arrow" size={20} /></button></div></td></tr>;
  })}</tbody></table></div></>;
}

const events: Record<string, string> = { sent: "Accepted by provider", delivered: "Delivered", opened: "Opened", clicked: "Clicked", bounced: "Bounced", complained: "Complaint", failed: "Failed", delivery_delayed: "Delivery delayed", suppressed: "Suppressed", unsubscribed: "Unsubscribed" };
export function ActivityTable({ records }: { records: MailEvent[] }) {
  return <div className="os-table-scroll"><table className="os-table"><thead><tr><th scope="col">Recipient email</th><th scope="col">Campaign</th><th scope="col">Event type</th><th scope="col">Event timestamp</th><th scope="col">Status</th><th scope="col">Clicked URL</th></tr></thead><tbody>{records.map((event, index) => {
    const kind = event.event_type.replace(/^email\./, "");
    const label = events[kind] ?? statusLabel(kind);
    let link: string | null = null;
    try { const candidate = new URL(event.clicked_url ?? ""); if (["https:", "http:"].includes(candidate.protocol) && !candidate.username && !candidate.password) link = candidate.href; } catch { /* No safe stored link. */ }
    return <tr key={event.id ?? index}><td>{event.email ?? "Unavailable"}</td><td>{event.campaign_name ?? "Unavailable"}</td><td>{statusLabel(kind)}</td><td>{date(event.event_at)}</td><td><span className={`event-badge ${events[kind] ? kind : "unknown"}`}>{label}</span></td><td>{kind === "clicked" && link ? <a className="activity-link" href={link} target="_blank" rel="noreferrer">{link}</a> : "—"}</td></tr>;
  })}</tbody></table></div>;
}
