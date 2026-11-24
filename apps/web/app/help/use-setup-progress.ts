"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { deriveSetup, type SetupSnapshot } from "../../lib/guided-setup";
import { campaignCapabilities } from "../../lib/campaign-capabilities";
import { requestJson } from "../dashboard/types";
import { notifications } from "../dashboard/notifications";
import { setupUpdatedEvent } from "./events";

/** One mounted cache per authenticated shell; no credentials or cross-session module cache. */
export function useSetupProgress() {
  const [snapshot, setSnapshot] = useState<SetupSnapshot | null>(null);
  const [loading, setLoading] = useState(false); const [error, setError] = useState("");
  const inFlight = useRef<Promise<void> | null>(null); const controller = useRef<AbortController | null>(null);
  const lastLoaded = useRef(0); const alive = useRef(false); const invalidated = useRef(false);
  const refresh = useCallback((force = true): Promise<void> => {
    if (inFlight.current) { if (force) invalidated.current = true; return inFlight.current; }
    if (!force && Date.now() - lastLoaded.current < 30000) return Promise.resolve();
    const request = new AbortController(); controller.current = request;
    setLoading(true);
    const operation = async () => {
      try {
        const result = await requestJson<SetupSnapshot>("/api/dashboard/setup", { signal: request.signal });
        if (!alive.current || request.signal.aborted) return;
        if (result.version !== 1 || result.steps?.length !== 7 || !result.readiness?.checks) throw new Error("Setup status format is unavailable.");
        setSnapshot(result); lastLoaded.current = Date.now();
        const message = result.verification !== "verified" ? "Some setup evidence could not be loaded. Unknown checks are not marked complete. Retry when the connection is restored." : "";
        setError(message);
        if (message) notifications.failed("setup-status", "setup status", message, () => { void refresh(true); });
        else { notifications.loaded("setup-status", "setup status", false, false); notifications.cancel("setup-status"); }
      } catch (failure) {
        if (!alive.current || request.signal.aborted) return;
        const message = failure instanceof Error ? failure.message : "Setup status unavailable. Retry the check.";
        // Replace stale green checks with unknown, not with disconnected/empty values.
        setSnapshot(deriveSetup({ connection: null, facts: null }, campaignCapabilities)); setError(message);
        notifications.failed("setup-status", "setup status", message, () => { void refresh(true); });
      } finally {
        if (alive.current && !request.signal.aborted) setLoading(false);
      }
    };
    const pending = operation().finally(() => { if (inFlight.current === pending) inFlight.current = null; });
    inFlight.current = pending;
    return pending;
  }, []);
  useEffect(() => {
    alive.current = true; let timer: ReturnType<typeof setTimeout> | undefined;
    // Defer guidance independently; never suspend the existing overview.
    timer = setTimeout(() => { void refresh(false); }, 150);
    const changed = () => { invalidated.current = true; clearTimeout(timer); timer = setTimeout(() => { invalidated.current = false; void refresh(true).then(() => { if (alive.current && invalidated.current) { invalidated.current = false; void refresh(true); } }); }, 350); };
    const focus = () => { if (document.visibilityState === "visible") void refresh(false); };
    window.addEventListener(setupUpdatedEvent, changed); window.addEventListener("focus", focus); document.addEventListener("visibilitychange", focus);
    return () => { alive.current = false; clearTimeout(timer); controller.current?.abort(); inFlight.current = null; window.removeEventListener(setupUpdatedEvent, changed); window.removeEventListener("focus", focus); document.removeEventListener("visibilitychange", focus); notifications.cancel("setup-status"); };
  }, [refresh]);
  return { snapshot, loading, error, refresh };
}
