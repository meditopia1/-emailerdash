/** Project stored events without exposing raw webhook payloads. */
export function storedClickUrl(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const click = record.click && typeof record.click === "object" ? record.click as Record<string, unknown> : null;
  const candidate = click?.link ?? record.url;
  if (typeof candidate !== "string" || candidate.length > 2048) return null;
  try { const url = new URL(candidate); return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}

export function embeddedCount(value: unknown): number | null {
  if (!Array.isArray(value)) return null;
  if (!value.length) return 0;
  const count = (value[0] as { count?: unknown })?.count;
  return typeof count === "number" && Number.isFinite(count) && count >= 0 ? count : null;
}
