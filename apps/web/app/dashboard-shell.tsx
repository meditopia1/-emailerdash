"use client";

import { useCallback, useEffect, useState } from "react";
import { GuidanceProvider, HelpButton } from "./help/guidance";
import { GettingStarted } from "./help/getting-started";
import { AppearanceSettings, useAppearance } from "./dashboard/appearance";
import { Compose, Contacts, EmailSetup, EmptyState } from "./dashboard/forms";
import { Icon, type IconName } from "./dashboard/icons";
import { OverviewContent } from "./dashboard/overview";
import { Suppressions } from "./dashboard/suppressions";
import { useDashboardData } from "./dashboard/use-dashboard-data";
import { CampaignTable, ActivityTable } from "./dashboard/records";
import { toast } from "sonner";
import { formatNumber, requestJson, statusLabel, type Campaign, type Section } from "./dashboard/types";

const navigation: { section: Section; icon: IconName; label: string }[] = [
  { section: "Overview", icon: "overview", label: "Overview" },
  { section: "Compose & Send", icon: "compose", label: "Compose & Send" },
  { section: "Active Sending", icon: "sending", label: "Active Sending" },
  { section: "Campaign History", icon: "campaigns", label: "Campaign History" },
  { section: "Recipient Activity", icon: "activity", label: "Recipient Activity" },
  { section: "Contacts", icon: "contacts", label: "Contacts" },
];

export default function DashboardShell() {
  const [section, setSection] = useState<Section>("Overview");
  const [liveSending] = useState(true);
  const { data, loading, refreshing, error, updatedAt, refresh } = useDashboardData(section, liveSending);
  const refreshAfterSave = useCallback(() => refresh("mutation"), [refresh]);
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [campaignDetail, setCampaignDetail] = useState<any>(null);
  const [campaignDetailError, setCampaignDetailError] = useState("");
  const [builderCampaignId, setBuilderCampaignId] = useState<string | null>(null);
  const [builderOpened, setBuilderOpened] = useState(false);
  const { appearance, updateAppearance } = useAppearance();
  const navigate = useCallback((next: Section) => { setSection(next); if (next === "Compose & Send") setBuilderOpened(true); }, []);
  const openBuilder = useCallback((id: string | null) => { setBuilderCampaignId(id); setBuilderOpened(true); setSelectedCampaign(null); navigate("Compose & Send"); }, [navigate]);

  useEffect(() => {
    if (!selectedCampaign) return;
    const previous = document.activeElement as HTMLElement | null;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setSelectedCampaign(null); };
    document.addEventListener("keydown", close);
    document.querySelector<HTMLDivElement>(".campaign-drawer")?.focus();
    return () => { document.removeEventListener("keydown", close); previous?.focus(); };
  }, [selectedCampaign]);

  useEffect(() => {
    if (!selectedCampaign) { setCampaignDetail(null); setCampaignDetailError(""); return; }
    let cancelled = false;
    setCampaignDetail(null); setCampaignDetailError("");
    void requestJson<any>(`/api/dashboard/campaigns/${selectedCampaign.id}`).then(value => { if (!cancelled) setCampaignDetail(value); }).catch(error => { if (!cancelled) setCampaignDetailError(error instanceof Error ? error.message : "Campaign details unavailable."); });
    return () => { cancelled = true; };
  }, [selectedCampaign]);

  const campaigns = data?.campaigns ?? [];
  const filteredCampaigns = campaigns;
  const active = filteredCampaigns.filter(campaign => ["queued", "sending"].includes(campaign.status));
  const events = data?.events ?? [];
  const isSettings = section === "Settings" || section === "Email Setup";

  return <GuidanceProvider page={section} navigate={navigate} openCampaign={openBuilder}><main className="os-shell"><aside className="os-rail" aria-label="Main navigation"><button className="os-logo" aria-label="Marketing OS home" onClick={() => navigate("Overview")}><span>m</span><i /></button><nav>{navigation.map(item => <button key={item.section} className={`rail-button ${section === item.section ? "active" : ""}`} aria-label={item.label} aria-current={section === item.section ? "page" : undefined} data-tooltip={item.label} onClick={() => navigate(item.section)}><Icon name={item.icon} size={23} /></button>)}</nav><div className="rail-bottom"><HelpButton /><button className={`rail-button ${isSettings ? "active" : ""}`} aria-label="Settings" aria-current={isSettings ? "page" : undefined} data-tooltip="Settings" onClick={() => navigate("Settings")}><Icon name="settings" size={24} /></button><button className="rail-button" aria-label="Sign out" data-tooltip="Sign out" onClick={async () => { try { await requestJson("/api/auth/logout", { method: "POST" }); window.location.assign("/login"); } catch { toast.error("Could not sign out", { id: "logout", description: "Please try again.", duration: 6000 }); } }}><Icon name="logout" size={21} /></button><span className="rail-caption">MARKETING<br />OS LITE</span></div></aside>
    <div className={`os-workspace ${section === "Compose & Send" ? "builder-page" : ""}`}><header className="os-header"><div className="header-greeting"><span className="eyebrow">{section === "Active Sending" ? "EMAIL DELIVERY" : section === "Campaign History" ? "CAMPAIGN MANAGEMENT" : section === "Recipient Activity" ? "DELIVERY & ENGAGEMENT" : section === "Contacts" ? "AUDIENCE MANAGEMENT" : "YOUR EMAIL COMMAND CENTRE"}</span><h1>{section === "Overview" ? <>Welcome back <span className="greeting-wave" aria-label="waving hand">👋</span></> : section === "Email Setup" ? "Settings" : section === "Compose & Send" ? "A new conversation." : section === "Contacts" ? "Your contacts." : section === "Campaign History" ? "Your campaigns." : section === "Recipient Activity" ? "Email activity." : section === "Active Sending" ? "Sending queue." : section === "Suppressions" ? "Sending safeguards" : "Make it your own."}</h1></div><div className="header-tools"><button className="profile-button" aria-label="Open appearance settings" title="Appearance settings" onClick={() => navigate("Settings")}><span>A</span><i /></button></div></header>
      <div className="os-content">{error && section !== "Contacts" && <div className="os-error" role="alert"><Icon name="activity" size={20} /><span>{data ? "Showing previously loaded data. It may be outdated. " : ""}{error}</span><button className="os-button secondary" onClick={() => void refresh("manual")}><Icon name="refresh" size={15} />Retry</button></div>}
        {refreshing && data && !error && section !== "Contacts" && <p className="data-state-note" role="status">Refreshing data. Showing the last loaded results until the server responds.</p>}
        {section === "Overview" && <GettingStarted />}
        {section === "Overview" && (loading ? <DashboardSkeleton /> : data ? <OverviewContent data={data} query="" navigate={next => next === "Compose & Send" ? openBuilder(null) : navigate(next)} loading={loading} stale={Boolean(error)} onCampaign={setSelectedCampaign} /> : null)}
        {builderOpened && <div hidden={section !== "Compose & Send"}><Compose settings={data?.settings ?? null} navigate={navigate} onSaved={refreshAfterSave} campaignId={builderCampaignId} onCampaignChange={setBuilderCampaignId} appTheme={appearance.theme} visible={section === "Compose & Send"} /></div>}
        {(section === "Campaign History" || section === "Active Sending") && <section className="os-panel"><div className="section-heading"><div><span className="eyebrow">{section === "Active Sending" ? "EMAIL DELIVERY" : "CAMPAIGN MANAGEMENT"}</span><h2>{section === "Active Sending" ? "Live sending status" : "Campaign management"}</h2><p>{section === "Active Sending" ? "Only queued and currently sending campaigns appear here. Completed campaigns move to Campaign History." : "Create, manage and review all your email campaigns."}</p></div><button className="os-button" onClick={() => openBuilder(null)}><Icon name="plus" size={17} />New campaign</button></div>{loading || (refreshing && !data) ? <TableSkeleton /> : (section === "Active Sending" ? active : filteredCampaigns).length ? <CampaignTable sending={section === "Active Sending"} updatedAt={updatedAt} campaigns={section === "Active Sending" ? active : filteredCampaigns} onSelect={setSelectedCampaign} onOpen={openBuilder} /> : data && !error && !refreshing ? <EmptyState icon={section === "Active Sending" ? "sending" : "mail"} title={section === "Active Sending" ? "Nothing is sending right now." : "No campaigns created yet."} text={section === "Active Sending" ? "A campaign appears here only while it is queued or being sent. Check Campaign History for completed sends." : "Create your first campaign to start sending and tracking emails."} action="Create campaign" onAction={() => navigate("Compose & Send")} /> : null}</section>}
        {section === "Recipient Activity" && <section className="os-panel"><div className="section-heading"><div><span className="eyebrow">DELIVERY &amp; ENGAGEMENT</span><h2>Recipient activity</h2><p>Track email deliveries, opens, clicks and failures as they happen.</p></div><span className="round-icon accent"><Icon name="activity" /></span></div>{loading || (refreshing && !data) ? <TableSkeleton /> : events.length ? <ActivityTable records={events} /> : data && !error && !refreshing ? <EmptyState icon="activity" title="No email activity yet." text="Deliveries, opens, clicks and other events will appear here." /> : null}<p className="tracking-note">Open and click tracking can be affected by privacy features and automated scanners.</p></section>}
        {section === "Suppressions" && <Suppressions query="" navigate={navigate} />}
        {section === "Contacts" && <Contacts query="" />}
        {isSettings && <><div className="settings-tabs" role="tablist" aria-label="Settings categories"><button role="tab" aria-selected={section === "Settings"} className={section === "Settings" ? "active" : ""} onClick={() => navigate("Settings")}><Icon name="palette" size={18} />Appearance</button><button role="tab" aria-selected={section === "Email Setup"} className={section === "Email Setup" ? "active" : ""} onClick={() => navigate("Email Setup")}><Icon name="mail" size={18} />Email setup</button></div><div role="tabpanel">{section === "Settings" ? <AppearanceSettings appearance={appearance} onChange={updateAppearance} /> : loading ? <TableSkeleton /> : <EmailSetup settings={data?.settings ?? null} onSaved={refreshAfterSave} />}</div></>}
      </div><footer className="os-footer"><span>Every send. Every click. One place.</span><div><span className={`connection-indicator ${section === "Contacts" ? "" : error ? "offline" : loading ? "pending" : ""}`} /><span>{section === "Contacts" ? "Audience management" : error ? data ? "Connection interrupted · data may be outdated" : "Connection interrupted" : loading ? "Connecting…" : updatedAt ? `Updated ${updatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Waiting for data"}</span><button aria-label="Refresh dashboard" disabled={section !== "Contacts" && refreshing} onClick={() => section === "Contacts" ? window.dispatchEvent(new Event("audience-refresh")) : void refresh("manual")}><Icon name="refresh" size={14} /></button></div></footer>
    </div>
    {selectedCampaign && <div className="modal-backdrop" onClick={() => setSelectedCampaign(null)}><div className="campaign-drawer" role="dialog" aria-modal="true" aria-label="Campaign details" tabIndex={-1} onClick={event => event.stopPropagation()}><div className="section-heading"><span className="eyebrow">CAMPAIGN DETAILS</span><button className="icon-button-os" aria-label="Close campaign details" onClick={() => setSelectedCampaign(null)}><Icon name="close" /></button></div><span className="round-icon accent"><Icon name="mail" size={28} /></span><h2>{selectedCampaign.name}</h2><span className="status-pill">{statusLabel(selectedCampaign.status)}</span><button className="os-button" onClick={() => openBuilder(selectedCampaign.id)}>Open Visual Builder</button><p className="muted-os">Created {new Date(selectedCampaign.created_at).toLocaleString()}</p><div className="detail-metrics">{[["Recipients", selectedCampaign.total_count], ["Accepted", selectedCampaign.accepted_count], ["Delivered", selectedCampaign.delivered_count], ["Unique opens", selectedCampaign.opened_count], ["Unique clicks", selectedCampaign.clicked_count], ["Failed / blocked", selectedCampaign.failed_count + selectedCampaign.blocked_count]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{formatNumber(Number(value))}</strong></div>)}</div>{campaignDetailError ? <p className="os-error" role="alert">{campaignDetailError}</p> : campaignDetail ? <><section className="campaign-detail-section"><h3>Message</h3><p><strong>Subject:</strong> {campaignDetail.campaign.subject}</p><p><strong>From:</strong> {campaignDetail.campaign.sender_name} &lt;{campaignDetail.campaign.from_email}&gt;</p><pre>{campaignDetail.campaign.content_text || (campaignDetail.campaign.content_html || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() || "No message content saved."}</pre></section><section className="campaign-detail-section"><h3>Sent to {campaignDetail.recipients.length} recipient{campaignDetail.recipients.length === 1 ? "" : "s"}</h3><div className="campaign-recipient-list">{campaignDetail.recipients.map((recipient: { id: string; email: string; name: string | null; status: string }) => <div key={recipient.id}><span>{recipient.name || recipient.email}</span><small>{recipient.name ? recipient.email : ""} · {statusLabel(recipient.status)}</small></div>)}</div></section></> : <p className="muted-os">Loading message and recipient details…</p>}<p className="tracking-note">Accepted means the provider received the message. Delivery is confirmed separately.</p></div></div>}
  </main></GuidanceProvider>;
}

function DashboardSkeleton() { return <div className="dashboard-skeleton" role="status" aria-label="Loading dashboard"><span className="sr-only">Loading your workspace…</span><div><div className="skeleton-line" /><div className="skeleton-pair"><i /><i /></div><div className="skeleton-line" /><div className="skeleton-trio"><i /><i /><i /></div><div className="skeleton-block" /></div><div><div className="skeleton-line" /><div className="skeleton-calendar" /><div className="skeleton-row" /><div className="skeleton-row" /></div></div>; }
function TableSkeleton() { return <div className="table-skeleton" role="status" aria-label="Loading records"><span className="sr-only">Loading records…</span>{Array.from({ length: 5 }, (_, index) => <div className="skeleton-row" key={index} />)}</div>; }
