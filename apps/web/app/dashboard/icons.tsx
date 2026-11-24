import type { CSSProperties } from "react";

export type IconName = "overview" | "compose" | "sending" | "campaigns" | "activity" | "contacts" | "settings" | "logout" | "search" | "arrow" | "chevron-left" | "chevron-right" | "sun" | "moon" | "check" | "mail" | "close" | "refresh" | "plus" | "shield" | "palette" | "clock";

const paths: Record<IconName, React.ReactNode> = {
  overview: <><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /></>,
  compose: <><path d="m16 3 5 5-12 12-6 1 1-6Z" /><path d="m13 6 5 5" /></>,
  sending: <><path d="m22 2-7 20-4-9-9-4Z" /><path d="m22 2-11 11" /></>,
  campaigns: <><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M7 3v4m10-4v4M3 11h18m-13 5h8" /></>,
  activity: <><path d="M2 12h5l3-8 4 16 3-8h5" /></>,
  contacts: <><circle cx="9" cy="8" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3m2-16a3 3 0 0 1 0 6m1 4a5 5 0 0 1 3 5" /></>,
  settings: <><path d="m9 3-1 3-3 1-2 5 2 5 3 1 1 3h6l1-3 3-1 2-5-2-5-3-1-1-3Z" /><circle cx="12" cy="12" r="3" /></>,
  logout: <><path d="M9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4m5-13 5 5-5 5m-5-5h12" /></>,
  search: <><circle cx="10.5" cy="10.5" r="7.5" /><path d="m16 16 5 5" /></>,
  arrow: <><path d="M5 19 19 5M5 5h14v14" /></>,
  "chevron-left": <path d="m15 5-7 7 7 7" />,
  "chevron-right": <path d="m9 5 7 7-7 7" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></>,
  moon: <path d="M21 13A9 9 0 0 1 11 3a9 9 0 1 0 10 10Z" />,
  check: <path d="m5 12 4 4L19 6" />,
  mail: <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m3 7 9 6 9-6" /></>,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  refresh: <><path d="M20 7a9 9 0 1 0 1 9M20 2v6h-6" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  shield: <><path d="m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6Z" /><path d="m8 12 3 3 5-6" /></>,
  palette: <><path d="M12 3a9 9 0 1 0 0 18h2a2 2 0 0 0 1-4 2 2 0 0 1 1-4h2a3 3 0 0 0 3-3c0-4-4-7-9-7Z" /><path d="M7 10h.01M10 6h.01M15 7h.01M6 15h.01" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
};

export function Icon({ name, size = 22, style }: { name: IconName; size?: number; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}>{paths[name]}</svg>;
}
