export const helpPreferenceKey = "marketing-os-guidance-v1";
export type HelpPreferences = { version: 1; minimized: boolean; dismissedCompletion: boolean; tours: string[] };
export const defaultHelpPreferences: HelpPreferences = { version: 1, minimized: false, dismissedCompletion: false, tours: [] };
export function parseHelpPreferences(raw: string | null): HelpPreferences {
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    if (!value || typeof value !== "object" || !("version" in value) || value.version !== 1) return defaultHelpPreferences;
    const saved = value as Partial<HelpPreferences>;
    return { version: 1, minimized: saved.minimized === true, dismissedCompletion: saved.dismissedCompletion === true, tours: Array.isArray(saved.tours) ? saved.tours.filter((tour): tour is string => typeof tour === "string" && tour.length <= 80).slice(0, 20) : [] };
  } catch { return defaultHelpPreferences; }
}
