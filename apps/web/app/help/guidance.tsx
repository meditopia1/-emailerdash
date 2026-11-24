"use client";
import dynamic from "next/dynamic";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { CircleHelp } from "lucide-react";
import { toast } from "sonner";
import type { GuideAction, GuidePage, SetupSnapshot } from "../../lib/guided-setup";
import { useSetupProgress } from "./use-setup-progress";
import { defaultHelpPreferences, helpPreferenceKey, parseHelpPreferences, type HelpPreferences } from "./preferences";
const HelpDrawer = dynamic(() => import("./help-drawer"), { ssr: false });
const Walkthrough = dynamic(() => import("./walkthrough"), { ssr: false });
type Guidance = { snapshot: SetupSnapshot | null; loading: boolean; error: string; refresh: () => Promise<void>; minimized: boolean; minimize: (value: boolean) => void; act: (action: GuideAction) => void; openHelp: (article?: string) => void };
const Context = createContext<Guidance | null>(null);
export function useGuidance() { const value = useContext(Context); if (!value) throw new Error("Guidance provider missing"); return value; }

export function GuidanceProvider({ page, navigate, openCampaign, children }: { page: GuidePage; navigate: (page: GuidePage) => void; openCampaign: (id: string) => void; children: ReactNode }) {
  const progress = useSetupProgress();
  const [help, setHelp] = useState(false); const [article, setArticle] = useState<string | undefined>(); const [tour, setTour] = useState<GuidePage | null>(null);
  const [preferences, setPreferences] = useState<HelpPreferences>(defaultHelpPreferences); const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const revealCleanup = useRef<(() => void) | null>(null);
  useEffect(() => { try { setPreferences(parseHelpPreferences(localStorage.getItem(helpPreferenceKey))); } catch { /* Preferences are optional, never readiness evidence. */ } setPreferencesLoaded(true); return () => revealCleanup.current?.(); }, []);
  useEffect(() => { if (preferencesLoaded) try { localStorage.setItem(helpPreferenceKey, JSON.stringify(preferences)); } catch { /* Continue in memory if storage is unavailable. */ } }, [preferences, preferencesLoaded]);
  useEffect(() => { if (preferencesLoaded && progress.snapshot?.complete && !preferences.dismissedCompletion) setPreferences(current => ({ ...current, minimized: true, dismissedCompletion: true })); }, [preferencesLoaded, progress.snapshot?.complete, preferences.dismissedCompletion]);
  useEffect(() => { setTour(null); }, [page]);
  const act = useCallback((action: GuideAction) => {
    revealCleanup.current?.(); setHelp(false); setTour(null);
    if (action.campaignId) openCampaign(action.campaignId); else navigate(action.page);
    if (!action.target) return;
    // Wait for lazy page content, then focus a real destination. Never mutate form data.
    let stopped = false; let observer: MutationObserver | undefined;
    const cleanup = () => { stopped = true; observer?.disconnect(); clearTimeout(timer); clearTimeout(start); };
    const reveal = () => {
      if (stopped) return;
      const target = document.getElementById(action.target!);
      if (!target || !target.getClientRects().length) return;
      if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
      target.focus({ preventScroll: true }); target.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); cleanup();
    };
    const timer = setTimeout(() => { cleanup(); toast.error("Section not available yet", { description: `Stay on ${action.page}, finish loading or retry its data, then use Help again. Your entries are unchanged.`, duration: 6000 }); }, 9000);
    const start = setTimeout(() => { observer = new MutationObserver(reveal); observer.observe(document.body, { childList: true, subtree: true }); reveal(); }, 100);
    revealCleanup.current = cleanup;
  }, [navigate, openCampaign]);
  const openHelp = useCallback((id?: string) => { setTour(null); setArticle(id); setHelp(true); }, []);
  const minimize = useCallback((value: boolean) => setPreferences(current => ({ ...current, minimized: value })), []);
  function finishTour(completed: boolean) { if (completed && tour) setPreferences(current => ({ ...current, tours: [...new Set([...current.tours, tour])] })); setTour(null); }
  return <Context.Provider value={{ ...progress, refresh: () => progress.refresh(true), minimized: preferences.minimized, minimize, act, openHelp }}>{children}
    {help && <HelpDrawer page={page} initialArticle={article} onClose={() => setHelp(false)} onAction={act} onChecklist={() => { minimize(false); setHelp(false); navigate("Overview"); }} onTour={() => { setHelp(false); window.dispatchEvent(new Event("marketing-os:tour-prepare")); setTour(page); }} toured={preferences.tours.includes(page)} snapshot={progress.snapshot} loading={progress.loading} refresh={() => progress.refresh(true)} />}
    {tour && <Walkthrough page={tour} onFinish={finishTour} />}
  </Context.Provider>;
}
export function HelpButton() { const guidance = useGuidance(); return <button className="rail-button" aria-label="Help" data-tooltip="Help & setup guides" onClick={() => guidance.openHelp()}><CircleHelp size={23} /></button>; }
