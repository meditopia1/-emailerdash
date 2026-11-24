"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { GuidePage } from "../../lib/guided-setup";
type TourStep = { selector: string; title: string; text: string };
const tours: Partial<Record<GuidePage, TourStep[]>> = {
  Contacts: [
    { selector: '[data-guide="contact-add"]', title: "Add one contact", text: "Add a recipient who already opted in. Saving records your confirmation without extra consent fields. Creating a contact never sends an email." },
    { selector: '[data-guide="contact-import"]', title: "Import your CSV", text: "Upload, map columns and review validation before confirmation. Large jobs need the import worker running." },
    { selector: '[data-guide="contact-filters"]', title: "Find the right recipients", text: "Filter by details, consent, eligibility and more. Filters never override a suppression." },
    { selector: '[aria-label="Saved segment"]', title: "Reuse a saved segment", text: "Dynamic segments apply saved conditions. Static lists hold chosen members. Eligibility is still checked for each send." },
    { selector: '#audience-table', title: "Review your contact records", text: "Contact rows and sending eligibility appear here. Open a contact to review consent, history and suppression reasons. An empty table needs contacts first." },
  ],
  "Email Setup": [
    { selector: '#setup-connection', title: "Connect Resend", text: "Save the key from your Resend team. Full Access is needed only for managing domains here; saving does not validate sending." },
    { selector: '#setup-domain', title: "Verify the exact domain", text: "Import provider evidence or manually link a domain verified in Resend. Copy only exact DNS records; keep website and incoming-mail records." },
    { selector: '#setup-sender', title: "Save your sender", text: "Match the From domain exactly. Add a recognizable name, company and mailing address, then explicitly choose a default." },
    { selector: '#setup-tracking', title: "Track and explicitly test", text: "Configure the deployed webhook and signing secret. Send test email asks for your sender, owned destination and confirmation. This tour never sends." },
  ],
  "Compose & Send": [
    { selector: '.builder-toolbar', title: "Choose your editor", text: "Visual Builder and Standard Editor share the same saved draft. The four steps are Campaign Start, Audience, Email and Results." },
    { selector: '.react-flow__node[data-id="start"]|.builder-mobile-steps button:nth-child(1)|.builder-toolbar', title: "Campaign Start", text: "Set the campaign name and a saved sender. Moving or connecting nodes does not start sending." },
    { selector: '.react-flow__node[data-id="audience"]|.builder-mobile-steps button:nth-child(2)|.builder-toolbar', title: "Audience", text: "Choose contacts or a saved source. Review eligible and excluded recipients, then approve the current saved audience." },
    { selector: '.react-flow__node[data-id="email"]|.builder-mobile-steps button:nth-child(3)|.builder-toolbar', title: "Email", text: "Add the subject and content, preview the message and save. An unsaved canvas does not complete campaign setup." },
    { selector: '.react-flow__node[data-id="results"]|.builder-mobile-steps button:nth-child(4)|.builder-toolbar', title: "Results and safeguards", text: "Explicit tests send to one confirmed destination only. Real campaign launch is disabled because the dispatcher is unimplemented." },
  ],
};
const noSteps: TourStep[] = [];

export default function Walkthrough({ page, onFinish }: { page: GuidePage; onFinish: (completed: boolean) => void }) {
  const steps = tours[page] ?? noSteps; const [index, setIndex] = useState(0); const [position, setPosition] = useState<{ top: number; left: number } | null>(null); const [missing, setMissing] = useState(false);
  const tooltip = useRef<HTMLDivElement>(null); const finish = useRef(onFinish); finish.current = onFinish;
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); finish.current(false); } }; document.addEventListener("keydown", key); return () => { document.removeEventListener("keydown", key); previous?.focus(); }; }, []);
  useEffect(() => {
    const step = steps[index]; if (!step) return;
    let target: HTMLElement | null = null;
    setPosition(null); setMissing(false);
    const positionTooltip = () => {
      if (!target || !target.isConnected || !target.getClientRects().length) return;
      const rect = target.getBoundingClientRect(); const width = Math.min(340, window.innerWidth - 24); const height = tooltip.current?.offsetHeight ?? 260;
      const below = rect.bottom + 14; const top = below + height < window.innerHeight - 12 ? below : Math.max(12, Math.min(rect.top - height - 14, window.innerHeight - height - 12));
      setPosition({ top, left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)) });
    };
    const locate = () => {
      const candidate = step.selector.split("|").map(selector => document.querySelector<HTMLElement>(selector)).find(node => node?.getClientRects().length);
      if (!candidate?.getClientRects().length) return;
      target = candidate; observer?.disconnect(); clearTimeout(timer);
      target.classList.add("guide-highlight"); target.scrollIntoView({ block: "center", behavior: "auto" });
      positionTooltip(); requestAnimationFrame(() => { positionTooltip(); tooltip.current?.focus({ preventScroll: true }); });
    };
    const observer = new MutationObserver(locate); observer.observe(document.body, { childList: true, subtree: true });
    const timer = setTimeout(() => { observer.disconnect(); setMissing(true); setPosition({ top: 80, left: Math.max(12, (window.innerWidth - Math.min(340, window.innerWidth - 24)) / 2) }); }, 9000);
    locate(); window.addEventListener("resize", positionTooltip); window.addEventListener("scroll", positionTooltip, true);
    const size = typeof ResizeObserver !== "undefined" ? new ResizeObserver(positionTooltip) : null;
    if (tooltip.current) size?.observe(tooltip.current);
    return () => { observer.disconnect(); clearTimeout(timer); target?.classList.remove("guide-highlight"); size?.disconnect(); window.removeEventListener("resize", positionTooltip); window.removeEventListener("scroll", positionTooltip, true); };
  }, [index, steps]);
  if (!steps.length) return null;
  const step = steps[index];
  return createPortal(<div ref={tooltip} className="guide-tooltip" style={position ?? { top: 12, left: 12, visibility: "hidden" }} role="dialog" aria-modal="false" aria-label={`${page} walkthrough`} aria-describedby="tour-description" tabIndex={-1}><span className="eyebrow">{index + 1} OF {steps.length} · {page.toUpperCase()}</span><h3>{step.title}</h3><p id="tour-description">{missing ? "This section has not loaded. You can skip this tour, retry the page data and restart from Help. Your entries are unchanged." : step.text}</p><p className="tour-keyboard-note">Tab through controls. Escape to skip. Navigation stays available.</p><div className="tour-actions"><button className="text-button-os" onClick={() => onFinish(false)}>Skip tour</button><div><button className="os-button secondary" disabled={index === 0} onClick={() => setIndex(value => value - 1)}>Previous</button><button className="os-button" onClick={() => index === steps.length - 1 ? onFinish(true) : setIndex(value => value + 1)}>{index === steps.length - 1 ? "Finish" : "Next"}</button></div></div></div>, document.body);
}
