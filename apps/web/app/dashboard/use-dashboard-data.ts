"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { notifications } from "./notifications";
import { requestJson, type Overview, type Section } from "./types";

const names: Partial<Record<Section, string>> = { Overview: "dashboard", "Campaign History": "campaigns", "Active Sending": "sending queue", "Recipient Activity": "email activity" };
type Reason = "page" | "manual" | "background" | "mutation";
export function useDashboardData(section: Section, live = false) {
  const [data, setData] = useState<Overview | null>(null); const [error, setError] = useState("");
  const [loading, setLoading] = useState(true); const [refreshing, setRefreshing] = useState(false); const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const active = useRef(section); active.current = section;
  const mounted = useRef(false); const request = useRef<AbortController | null>(null); const lastFailure = useRef(false);
  const refresh = useCallback(async (reason: Reason = "manual", target: Section = active.current) => {
    if (reason === "background" && request.current) return;
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    const page = names[target] ?? "dashboard"; const announce = reason === "manual" || reason === "page";
    if (announce) notifications.loading("dashboard-data");
    setRefreshing(true);
    try {
      const view = target === "Contacts" ? "?view=contacts" : target === "Active Sending" ? "?view=sending" : "";
      const value = await requestJson<Overview>(`/api/dashboard/overview${view}`, { signal: controller.signal });
      if (!mounted.current || request.current !== controller) return;
      const restored = lastFailure.current; lastFailure.current = false;
      setData(value); setError(""); setUpdatedAt(new Date());
      notifications.loaded("dashboard-data", page, restored, announce);
    } catch (failure) {
      if (!mounted.current || request.current !== controller || controller.signal.aborted) return;
      const detail = failure instanceof Error ? failure.message : "The server could not load this data.";
      lastFailure.current = true; setError(detail);
      notifications.failed("dashboard-data", page, detail, () => { void refresh("manual"); });
    } finally {
      if (mounted.current && request.current === controller) { request.current = null; setLoading(false); setRefreshing(false); }
    }
  }, []);
  useEffect(() => {
    mounted.current = true; void refresh("page");
    const timer = setInterval(() => { if (document.visibilityState === "visible" && names[active.current]) void refresh("background"); }, live && section === "Active Sending" ? 3000 : 15000);
    return () => { mounted.current = false; clearInterval(timer); request.current?.abort(); request.current = null; notifications.cancel("dashboard-data"); };
  }, [refresh, live, section]);
  useEffect(() => {
    const handler = () => void refresh("manual");
    window.addEventListener("dashboard-refresh", handler);
    return () => window.removeEventListener("dashboard-refresh", handler);
  }, [refresh]);
  const previousSection = useRef(section);
  useEffect(() => {
    if (previousSection.current !== section) {
      const leavingAudience = previousSection.current === "Contacts";
      previousSection.current = section;
      if (names[section]) void refresh("page", section);
      else if (section === "Contacts") { request.current?.abort(); request.current = null; setRefreshing(false); }
      else if (leavingAudience) notifications.cancel("dashboard-data");
    }
  }, [section, refresh]);
  return { data, loading, refreshing, error, updatedAt, refresh };
}
