"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactFlowInstance } from "@xyflow/react";
import { AlertTriangle, BarChart3, Check, ChevronRight, Columns2, Eye, Flag, LayoutDashboard, Loader2, LockKeyhole, Mail, Maximize2, Moon, Save, Sun, Users, Workflow, X } from "lucide-react";
import { ApiRequestError, requestJson, statusLabel, type Section, type SenderSettings } from "../dashboard/types";
import { layoutSchema } from "../../lib/campaign-builder";
import { AudienceFields } from "./audience-fields";
import { EmailFields, StartFields } from "./draft-fields";
import { EmailPreview } from "./email-preview";
import { ResultsFields } from "./results-fields";
import { TestEmailDialog } from "../dashboard/test-email-dialog";
import { notifySave } from "../dashboard/notifications";
import { firstFieldError, focusFormField } from "../dashboard/field-errors";
import type { AudienceApproval } from "./model";
import type { EmailIntegration } from "../dashboard/email-integration-types";
import { campaignDraft, defaultLayout, defaultPositions, draftIssueDetails, draftIssues, emptyAudience, newDraft, stepLabels, steps, type Audience, type BuilderCampaign, type CampaignDetail, type Draft, type StepId, type WorkflowLayout } from "./model";

const WorkflowCanvas = dynamic(() => import("./workflow-canvas"), { ssr: false, loading: () => <div className="canvas-loading"><Loader2 size={22} />Loading visual canvas…</div> });
const icons = { start: Flag, audience: Users, email: Mail, results: BarChart3 };

export function CampaignComposer({ settings, navigate, onSaved, campaignId = null, onCampaignChange, appTheme = "light", visible = true }: { settings: SenderSettings | null; navigate: (section: Section) => void; onSaved: () => Promise<void>; campaignId?: string | null; onCampaignChange?: (id: string | null) => void; appTheme?: "light" | "dark"; visible?: boolean }) {
  const [draft, setDraft] = useState<Draft>(() => newDraft(settings));
  const [campaign, setCampaign] = useState<BuilderCampaign | null>(null);
  const [audience, setAudience] = useState<Audience>(emptyAudience);
  const [checking, setChecking] = useState(false);
  const [audienceError, setAudienceError] = useState("");
  const [mode, setMode] = useState<"visual" | "standard">("visual");
  const [selected, setSelected] = useState<StepId>("start");
  const [layout, setLayout] = useState<WorkflowLayout>(defaultLayout);
  const [layoutRevision, setLayoutRevision] = useState(0);
  const [savedDraft, setSavedDraft] = useState(() => JSON.stringify(newDraft(settings)));
  const [savedLayout, setSavedLayout] = useState(() => JSON.stringify(defaultLayout));
  const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(false); const [layoutBusy, setLayoutBusy] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [notice, setNotice] = useState(""); const [error, setError] = useState(""); const [conflict, setConflict] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [layoutConflict, setLayoutConflict] = useState(false);
  const [failedLoadId, setFailedLoadId] = useState<string | null>(null);
  const [preview, setPreview] = useState(false); const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [testIntegration, setTestIntegration] = useState<EmailIntegration | null>(null);
  const [savedApproval, setSavedApproval] = useState<AudienceApproval | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const flow = useRef<ReactFlowInstance | null>(null); const initializedId = useRef<string | null | undefined>(undefined); const saving = useRef(false); const audienceRequest = useRef(0);
  const loadRequest = useRef(0);
  const layoutSaving = useRef(false);
  const draftRef = useRef(draft); draftRef.current = draft;
  const monitor = Boolean(campaign && campaign.status !== "draft");
  const dirty = !monitor && JSON.stringify(draft) !== savedDraft;
  const layoutDirty = JSON.stringify(layout) !== savedLayout;
  const dirtyRef = useRef(dirty); dirtyRef.current = dirty;
  const unsavedRef = useRef(dirty || layoutDirty); unsavedRef.current = dirty || layoutDirty;
  const campaignRef = useRef(campaign); campaignRef.current = campaign;

  useEffect(() => { try { if (localStorage.getItem("marketing-os-appearance")) setTheme(appTheme); } catch { /* Dark canvas default. */ } }, [appTheme]);
  useEffect(() => {
    if (!settings || campaignRef.current) return;
    setDraft(current => {
      if (current.from_email) return current;
      const next = { ...current, sender_name: current.sender_name || settings.sender_name, from_email: settings.from_email, reply_to: current.reply_to || settings.reply_to || "" };
      if (!dirtyRef.current) setSavedDraft(JSON.stringify(next));
      return next;
    });
  }, [settings]);

  const loadCampaign = useCallback(async (id: string) => {
    const sequence = ++loadRequest.current; audienceRequest.current++; setChecking(false);
    setLoading(true); setError("");
    try {
      const detail = await requestJson<CampaignDetail>(`/api/dashboard/campaigns/${id}`);
      if (sequence !== loadRequest.current) return;
      const loadedDraft = campaignDraft(detail.campaign); const parsed = layoutSchema.safeParse(detail.campaign.workflow_layout); const loadedLayout = parsed.success ? parsed.data : defaultLayout;
      setCampaign(detail.campaign); setDraft(loadedDraft); setFieldErrors({}); setSavedDraft(JSON.stringify(loadedDraft)); setAudience(detail.audience); setLayout(loadedLayout); setSavedLayout(JSON.stringify(loadedLayout)); setLayoutRevision(detail.campaign.layout_revision); setSelected(detail.campaign.status === "draft" ? loadedLayout.selectedNode : "results"); setConflict(false); setNotice("");
      if (flow.current) { void flow.current.setViewport(loadedLayout.viewport); }
      setLayoutConflict(false); setFailedLoadId(null);
      setSavedApproval(detail.audience_approval ?? null);
    } catch (failure) { if (sequence === loadRequest.current) { setFailedLoadId(id); setError(failure instanceof Error ? failure.message : "Could not open this campaign."); } }
    finally { if (sequence === loadRequest.current) setLoading(false); }
  }, []);

  useEffect(() => {
    if (initializedId.current === campaignId) return;
    if (saving.current || layoutSaving.current) { setError("Wait for this save to finish before opening another campaign."); onCampaignChange?.(campaignRef.current?.id ?? null); return; }
    if (unsavedRef.current && initializedId.current !== undefined && campaignId !== campaignRef.current?.id && !window.confirm("You have unsaved campaign or layout changes. Discard them and open another campaign?")) { onCampaignChange?.(campaignRef.current?.id ?? null); return; }
    initializedId.current = campaignId;
    if (campaignId) void loadCampaign(campaignId);
    else { loadRequest.current++; audienceRequest.current++; setLoading(false); setChecking(false); setAudienceError(""); const next = newDraft(settings); setCampaign(null); setSavedApproval(null); setFieldErrors({}); setDraft(next); setSavedDraft(JSON.stringify(next)); setLayout(defaultLayout); setSavedLayout(JSON.stringify(defaultLayout)); setLayoutRevision(0); setSelected("start"); setAudience(emptyAudience); setNotice(""); setError(""); setConflict(false); setLayoutConflict(false); setFailedLoadId(null); }
  }, [campaignId, loadCampaign, onCampaignChange, settings]);

  useEffect(() => {
    if (!dirty && !layoutDirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault(); window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, layoutDirty]);

  useEffect(() => {
    if (!visible || !campaign || !["queued", "sending"].includes(campaign.status)) return;
    let alive = true; let pending = false; const controller = new AbortController();
    const timer = setInterval(async () => {
      if (pending || document.visibilityState !== "visible") return; pending = true;
      try { const detail = await requestJson<CampaignDetail>(`/api/dashboard/campaigns/${campaign.id}`, { signal: controller.signal }); if (alive) { setCampaign(detail.campaign); setAudience(detail.audience); setError(""); } }
      catch (failure) { if (alive) setError(failure instanceof Error ? failure.message : "Progress could not be refreshed."); }
      finally { pending = false; }
    }, 6000);
    return () => { alive = false; clearInterval(timer); controller.abort(); };
  }, [campaign?.id, campaign?.status, visible]);

  const validateAudience = useCallback(async (ids: string[] = draftRef.current.audience_contact_ids) => {
    const sequence = ++audienceRequest.current; setChecking(true); setAudienceError("");
    try { const result = await requestJson<Audience>("/api/dashboard/contacts/audience", { method: "POST", body: JSON.stringify({ action: "preview", contact_ids: ids, selection: draftRef.current.audience_selection ?? { type: "contacts" } }) }); if (sequence === audienceRequest.current) setAudience(result); }
    catch (failure) { if (sequence === audienceRequest.current) setAudienceError(failure instanceof Error ? failure.message : "Audience could not be validated."); }
    finally { if (sequence === audienceRequest.current) setChecking(false); }
  }, []);
  const audienceKey = draft.audience_contact_ids.join(",") + JSON.stringify(draft.audience_selection ?? { type: "contacts" });
  useEffect(() => { if (!visible || monitor) return; const timer = setTimeout(() => void validateAudience(), 300); return () => clearTimeout(timer); }, [audienceKey, visible, monitor, validateAudience]);

  const changeDraft = useCallback((patch: Partial<Draft>) => { if (campaignRef.current && campaignRef.current.status !== "draft") return; if (patch.audience_contact_ids) { audienceRequest.current++; setChecking(true); } setDraft(current => ({ ...current, ...patch })); clearFieldErrors(patch); setNotice(""); }, []);
  const selectStep = useCallback((step: StepId) => { setSelected(step); setLayout(current => current.selectedNode === step ? current : { ...current, selectedNode: step }); setInspectorOpen(true); }, []);
  function focusBuilderField(field: string, step: StepId, message: string, announce = false) {
    setFieldErrors(current => ({ ...current, [field]: message }));
    selectStep(step);
    window.setTimeout(() => focusFormField(field, message, announce), 60);
  }
  function clearFieldErrors(patch: Partial<Draft>) {
    setFieldErrors(current => {
      const next = { ...current };
      for (const field of Object.keys(patch)) delete next[field];
      if (patch.content_text !== undefined || patch.content_html !== undefined) delete next.content;
      return next;
    });
  }
  const setPosition = useCallback((step: StepId, position: { x: number; y: number }) => { setLayout(current => ({ ...current, positions: { ...current.positions, [step]: position } })); }, []);

  async function saveLayout(id = campaign?.id, revision = layoutRevision) {
    if (layoutSaving.current) return;
    if (!id) { setNotice("Save the campaign draft once before saving its canvas layout."); return; }
    layoutSaving.current = true; setLayoutBusy(true);
    try {
      const saved = await notifySave("save-campaign", () => requestJson<{ workflow_layout: WorkflowLayout; layout_revision: number }>(`/api/dashboard/campaigns/${id}`, { method: "PATCH", body: JSON.stringify({ kind: "layout", expected_revision: revision, layout }) }));
      setLayoutRevision(saved.layout_revision); setSavedLayout(JSON.stringify(saved.workflow_layout)); setNotice("Workflow layout saved."); setLayoutConflict(false);
    } catch (failure) { const message = failure instanceof Error ? failure.message : "Could not save layout."; setError(message); if (message.includes("layout changed")) setLayoutConflict(true); }
    finally { layoutSaving.current = false; setLayoutBusy(false); }
  }

  async function saveDraft() {
    if (saving.current || monitor || loading) return;
    const issues = draftIssueDetails(draft); if (issues.length) { const first = issues[0]; setError(first.message); focusBuilderField(first.field, first.step, first.message, true); return; }
    saving.current = true; setBusy(true); setError(""); setNotice("");
    const snapshot = { ...draft, audience_contact_ids: [...draft.audience_contact_ids] };
    try {
      const saved = await notifySave("save-campaign", () => requestJson<BuilderCampaign>(campaign ? `/api/dashboard/campaigns/${campaign.id}` : "/api/dashboard/campaigns", { method: campaign ? "PATCH" : "POST", body: JSON.stringify(campaign ? { kind: "draft", expected_revision: campaign.revision, draft: snapshot } : snapshot) }));
      setCampaign(saved); setSavedDraft(JSON.stringify(snapshot)); initializedId.current = saved.id; onCampaignChange?.(saved.id); setConflict(false);
      setSavedApproval(null);
      if (layoutDirty || !campaign) await saveLayout(saved.id, saved.layout_revision);
      setNotice("Draft saved. No emails have been queued or sent."); await onSaved();
    } catch (failure) { const message = failure instanceof Error ? failure.message : "Could not save campaign."; setError(message); if (/changed|updated elsewhere|no longer a draft/.test(message)) setConflict(true); if (failure instanceof ApiRequestError) { const first = firstFieldError(failure.fieldErrors); if (first) { const step: StepId = ["name"].includes(first.field) ? "start" : "email"; focusBuilderField(first.field, step, first.message); } } }
    finally { saving.current = false; setBusy(false); }
  }

  async function launchCampaign() {
    if (!campaign || dirty || checking || audience.excluded || !savedApproval || savedApproval.fingerprint !== audience.fingerprint || launching) return;
    if (!window.confirm(`Launch “${campaign.name}” to ${savedApproval.eligible_count} approved recipient${savedApproval.eligible_count === 1 ? "" : "s"}? This sends real email.`)) return;
    setLaunching(true); setError(""); setNotice("");
    try {
      const result = await notifySave("launch-campaign", () => requestJson<{ campaign: BuilderCampaign; queued: number }>(`/api/dashboard/campaigns/${campaign.id}`, { method: "PATCH", body: JSON.stringify({ kind: "launch", expected_revision: campaign.revision, confirmed: true }) }));
      setCampaign(result.campaign); setSavedDraft(JSON.stringify(campaignDraft(result.campaign))); setSavedApproval(null); setNotice(`${result.queued} recipient${result.queued === 1 ? "" : "s"} queued. The worker is sending in the background.`); await onSaved();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Campaign could not be launched."); }
    finally { setLaunching(false); }
  }

  function reloadCampaign() { if (campaign && (!dirty || window.confirm("Reload the saved campaign? Your unsaved content changes will be discarded."))) void loadCampaign(campaign.id); }
  async function reloadLayout() {
    if (!campaign || (layoutDirty && !window.confirm("Reload the saved layout? Your unsaved node positions will be discarded; campaign content will be kept."))) return;
    try {
      const detail = await requestJson<CampaignDetail>(`/api/dashboard/campaigns/${campaign.id}`);
      const parsed = layoutSchema.safeParse(detail.campaign.workflow_layout); const saved = parsed.success ? parsed.data : defaultLayout;
      setLayout(saved); setSavedLayout(JSON.stringify(saved)); setLayoutRevision(detail.campaign.layout_revision); setSelected(saved.selectedNode); setLayoutConflict(false); setError(""); void flow.current?.setViewport(saved.viewport);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not reload layout."); }
  }
  const closePreview = useCallback(() => setPreview(false), []);
  const selectedIndex = steps.indexOf(selected); const SelectedIcon = icons[selected];
  const headerText = monitor ? "Monitor mode" : "Build mode";
  const sharedFields = { draft, onChange: changeDraft, readOnly: monitor || loading || busy, errors: fieldErrors };
  async function openTest() {
    try { setTestIntegration(await requestJson<EmailIntegration>("/api/dashboard/settings/resend")); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Could not open test sending."); }
  }
  const emailFields = <EmailFields {...sharedFields} senderSettings={settings} onPreview={() => setPreview(true)} onSender={() => navigate("Email Setup")} onTest={() => void openTest()} />;
  const audienceFields = <AudienceFields {...sharedFields} audience={audience} checking={checking} onValidate={() => void validateAudience()} campaign={campaign} savedApproval={savedApproval} canApprove={!dirty && !busy && !loading} onApproved={async (revision, ids, approval) => {
    if (!campaign) return;
    const updated = { ...campaign, revision, audience_contact_ids: ids }; setCampaign(updated);
    const next = campaignDraft(updated); setDraft(next); setSavedDraft(JSON.stringify(next));
    setSavedApproval(approval);
    setNotice("Audience snapshot approved. No emails have been queued or sent."); await onSaved();
  }} />;
  const launchReady = Boolean(campaign && !dirty && !checking && !draftIssues(draft).length && audience.eligible > 0 && !audience.excluded && savedApproval && savedApproval.fingerprint === audience.fingerprint);
  const resultFields = <ResultsFields draft={draft} campaign={campaign} audience={audience} checking={checking} validationError={audienceError} onValidate={() => void validateAudience()} onLaunch={() => void launchCampaign()} launching={launching} launchReady={launchReady} />;

  return <section className={`campaign-builder ${mode === "visual" ? "visual-mode" : "standard-mode"}`} data-builder-theme={theme} aria-label="Campaign editor">
    <div className="builder-topbar"><div className="builder-breadcrumb"><Workflow size={17} /><button type="button" onClick={() => navigate("Campaign History")}>Campaigns</button><ChevronRight size={13} /><strong>{draft.name || "Untitled campaign"}</strong><span className="builder-status">{statusLabel(campaign?.status ?? "draft")}</span></div><div className="builder-top-actions"><span className={`save-indicator ${dirty || layoutDirty ? "unsaved" : ""}`}><i />{busy ? "Saving…" : dirty || layoutDirty ? "Unsaved changes" : campaign ? "Saved" : "New draft"}</span><button type="button" className="builder-icon-button" aria-label={theme === "dark" ? "Use light canvas" : "Use dark canvas"} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}</button>{!monitor && <button type="button" className="builder-button" disabled={busy || loading || conflict} onClick={() => void saveDraft()}>{busy ? <Loader2 className="builder-spin" size={15} /> : <Save size={15} />}{busy ? "Saving…" : "Save draft"}</button>}</div></div>
    <div className="builder-toolbar"><div className="builder-segment" role="group" aria-label="Campaign editor mode"><button type="button" aria-pressed={mode === "visual"} onClick={() => setMode("visual")}><Workflow size={15} />Visual Builder</button><button type="button" aria-pressed={mode === "standard"} onClick={() => setMode("standard")}><Columns2 size={15} />Standard Editor</button></div><div className="builder-canvas-actions"><span className={`builder-mode-badge ${monitor ? "monitor" : ""}`}><span />{headerText}</span>{mode === "visual" && <><button type="button" className="builder-icon-button" aria-label="Fit workflow into view" onClick={() => void flow.current?.fitView({ padding: .16, duration: 250, maxZoom: 1 })}><Maximize2 size={16} /></button><button type="button" className="builder-icon-button" aria-label="Toggle configuration inspector" onClick={() => setInspectorOpen(current => !current)}><LayoutDashboard size={16} /></button><button type="button" className="builder-button secondary compact" disabled={layoutBusy || loading || !campaign} onClick={() => void saveLayout()}><Save size={14} />{layoutBusy ? "Saving…" : "Save layout"}</button></>}</div></div>
    {(error || audienceError) && <div className="builder-banner error" role="alert"><AlertTriangle size={16} /><span>{error || audienceError}</span>{failedLoadId && <button type="button" onClick={() => void loadCampaign(failedLoadId)}>Retry opening campaign</button>}{conflict && <button type="button" onClick={reloadCampaign}>Reload saved campaign</button>}{layoutConflict && <button type="button" onClick={() => void reloadLayout()}>Reload saved layout</button>}{!conflict && !layoutConflict && <button type="button" aria-label="Dismiss editor error" onClick={() => { setError(""); setAudienceError(""); }}><X size={14} /></button>}</div>}
    {notice && <div className="builder-banner" role="status"><Check size={15} /><span>{notice}</span></div>}
    {loading ? <div className="builder-loading" role="status"><Loader2 className="builder-spin" size={24} /><span>Opening campaign…</span></div> : <>
      <div className="builder-mobile-steps" role="group" aria-label="Campaign configuration steps">{steps.map(step => { const StepIcon = icons[step]; return <button type="button" key={step} aria-pressed={selected === step} onClick={() => selectStep(step)}><StepIcon size={15} />{stepLabels[step]}</button>; })}</div>
      {mode === "visual" ? <div className={`builder-workspace ${inspectorOpen ? "with-inspector" : ""}`}><div className="builder-canvas"><WorkflowCanvas draft={draft} campaign={campaign} audience={audience} checking={checking || Boolean(audienceError)} layout={layout} selected={selected} onSelect={selectStep} onPosition={setPosition} onViewport={viewport => setLayout(current => ({ ...current, viewport }))} onInit={instance => { flow.current = instance as unknown as ReactFlowInstance; }} theme={theme} /></div>{inspectorOpen && <aside className="builder-inspector" aria-label={`${stepLabels[selected]} configuration`}><div className="inspector-heading"><span className={`inspector-category category-${selected}`}><SelectedIcon size={17} /></span><div><span>STEP 0{selectedIndex + 1}</span><h2>{stepLabels[selected]}</h2></div><button type="button" aria-label="Close configuration inspector" className="builder-icon-button" onClick={() => setInspectorOpen(false)}><X size={17} /></button></div><div className="inspector-content">{selected === "start" && <><StartFields {...sharedFields} /><dl className="campaign-metadata"><div><dt>Campaign ID</dt><dd>{campaign?.id ?? "Assigned when saved"}</dd></div><div><dt>Created</dt><dd>{campaign ? new Date(campaign.created_at).toLocaleString() : "Not saved yet"}</dd></div><div><dt>Current state</dt><dd>{statusLabel(campaign?.status ?? "draft")}</dd></div></dl><p className="builder-notice"><LockKeyhole size={15} />Connections show the existing campaign process. Moving nodes does not send email or create automations.</p><button type="button" className="builder-text-button" onClick={() => { setLayout(current => ({ ...current, positions: defaultPositions })); requestAnimationFrame(() => void flow.current?.fitView({ padding: .16, duration: 250, maxZoom: 1 })); }}>Reset node positions</button></>}{selected === "audience" && audienceFields}{selected === "email" && emailFields}{selected === "results" && resultFields}</div><div className="inspector-footer"><span>0{selectedIndex + 1} of 04</span><button type="button" className="builder-button secondary compact" onClick={() => selectStep(steps[(selectedIndex + 1) % steps.length])}>{selected === "results" ? "Back to start" : `Next: ${stepLabels[steps[selectedIndex + 1]]}`}<ChevronRight size={14} /></button></div></aside>}</div> : <div className="builder-standard"><div className="standard-section"><span className="builder-section-number">01</span><div><h2>Make something worth opening.</h2><p>The standard editor uses the same campaign data as the canvas.</p><StartFields {...sharedFields} /></div></div><div className="standard-section"><span className="builder-section-number">02</span><div><h2>Choose your audience</h2>{audienceFields}</div></div><div className="standard-section"><span className="builder-section-number">03</span><div><h2>Compose your email</h2>{emailFields}</div></div><div className="standard-section"><span className="builder-section-number">04</span><div><h2>Review & results</h2>{resultFields}</div></div></div>}
    </>}
    <div className="builder-bottom-bar"><span><LockKeyhole size={12} />{monitor ? "Campaign content is read-only. Layout changes are safe." : "Drafts are never sent automatically."}</span><button type="button" className="builder-text-button" onClick={() => setPreview(true)}><Eye size={14} />Preview email</button></div>
    {preview && <EmailPreview draft={draft} audience={audience} onClose={closePreview} />}
    {testIntegration && <TestEmailDialog integration={testIntegration} initialFrom={draft.from_email} content={{ subject: draft.subject, ...(draft.content_format === "html" ? { html: draft.content_html } : { text: draft.content_text }) }} onClose={() => setTestIntegration(null)} onSent={async () => { await onSaved(); }} />}
  </section>;
}
