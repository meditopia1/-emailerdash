"use client";
import { ArrowRight, Check, ChevronDown, ChevronUp, CircleHelp, RefreshCw } from "lucide-react";
import { setupDefinitions, setupOrder, stateLabel } from "../../lib/guided-setup";
import { useGuidance } from "./guidance";

export function GettingStarted() {
  const { snapshot, loading, error, refresh, minimized, minimize, act, openHelp } = useGuidance();
  const current = snapshot?.steps.find(step => step.id === snapshot.current);
  const dispatch = snapshot?.readiness.checks.find(check => check.id === "dispatch");
  const configurationWarning = minimized ? snapshot?.steps.find(step => ["connection", "domain", "sender"].includes(step.id) && step.state !== "complete") : null;
  const remaining = setupOrder.length - (snapshot?.completed ?? 0);
  return <section className="os-panel getting-started" aria-labelledby="getting-started-title">
    <div className="setup-heading"><div><span className="eyebrow">GETTING STARTED</span><h2 id="getting-started-title">{snapshot?.complete ? "Your workspace is set up." : "Let's get you ready to send."}</h2>{!minimized && <p>Follow these steps to set up your workspace and launch your first email campaign.</p>}</div><div className="setup-controls"><button className="icon-button-os" aria-label="Open setup help" onClick={() => openHelp()}><CircleHelp size={20} /></button><button className="icon-button-os" aria-label={minimized ? "Expand setup checklist" : "Minimize setup checklist"} aria-expanded={!minimized} aria-controls="setup-checklist-body" onClick={() => minimize(!minimized)}>{minimized ? <ChevronDown size={20} /> : <ChevronUp size={20} />}</button></div></div>
    <div className="setup-progress-row"><div className="setup-progress-track" role="progressbar" aria-label="Verified setup steps" aria-valuemin={0} aria-valuemax={7} aria-valuenow={snapshot ? snapshot.completed : undefined} aria-valuetext={snapshot ? `${snapshot.completed} of 7 complete${snapshot.verification !== "verified" ? "; some checks could not be verified" : ""}` : "Checking setup"}><span style={{ width: snapshot ? `${snapshot.completed / 7 * 100}%` : "0%" }} /></div><span>{snapshot ? `${snapshot.completed} of 7 complete` : "Checking setup…"}</span><button className="text-button-os" disabled={loading} onClick={() => void refresh()} aria-label="Refresh setup status"><RefreshCw size={14} className={loading ? "builder-spin" : ""} />{loading ? "Checking…" : "Refresh"}</button></div>
    {error && <p className="setup-notice" role="alert">{error} <button className="text-button-os" disabled={loading} onClick={() => void refresh()}>Retry setup check</button></p>}
    {dispatch && dispatch.state !== "complete" && <p className="setup-dispatch-note"><strong>Campaign launch needs review.</strong> Save the draft, test the sender, approve eligible recipients and confirm the launch. <button className="text-button-os" onClick={() => openHelp("launch")}>What can I do?</button></p>}
    {configurationWarning && <p className="setup-notice"><strong>{setupDefinitions[configurationWarning.id].title}: {stateLabel[configurationWarning.state]}.</strong> {configurationWarning.reason} <button className="text-button-os" onClick={() => act(configurationWarning.action)}>Open Email Setup</button></p>}
    <div id="setup-checklist-body" hidden={minimized}>
      {!snapshot ? <div className="setup-loading" role="status"><div className="skeleton-row" /><span>Checking saved configuration. Your dashboard remains available.</span></div> : <>
        <ol className="setup-steps">{snapshot.steps.map((step, index) => { const copy = setupDefinitions[step.id]; return <li key={step.id} className={`setup-step ${step.state}${current?.id === step.id ? " current" : ""}`} aria-current={current?.id === step.id ? "step" : undefined}><span className="setup-step-number" aria-hidden="true">{step.state === "complete" ? <Check size={17} /> : index + 1}</span><div><div className="setup-step-title"><h3>{copy.title}</h3><span className="setup-state">{stateLabel[step.state]}</span></div><p>{copy.description}</p>{(current?.id === step.id || step.state === "needs_attention" || step.state === "unable_to_verify") && <p className="setup-reason">{step.reason}</p>}</div><button className="text-button-os" onClick={() => act(step.action)}>{step.state === "complete" ? "Review" : copy.button}<ArrowRight size={14} /></button></li>; })}</ol>
        <div className="setup-bottom"><span>{snapshot.complete ? "Setup complete. Help and sending safeguards remain available." : `${remaining} step${remaining === 1 ? "" : "s"} remaining. A test never counts as a campaign launch.`}</span>{current && <button className="os-button" onClick={() => act(current.action)}>Continue setup<ArrowRight size={16} /></button>}</div>
      </>}
    </div>
    {minimized && current && <div className="setup-collapsed-next"><span>Next: {setupDefinitions[current.id].title}</span><button className="text-button-os" onClick={() => act(current.action)}>Continue<ArrowRight size={14} /></button></div>}
  </section>;
}
