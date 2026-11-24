const encoder = new TextEncoder();

function decodeBase64Url(value: string) { const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "="); return atob(normalized); }
export async function isValidAdminSessionEdge(value: string | undefined, secret: string | undefined) {
  if (!value || !secret) return false;
  const [payload, signature] = value.split("."); if (!payload || !signature) return false;
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify("HMAC", key, Uint8Array.from(decodeBase64Url(signature), (char) => char.charCodeAt(0)), encoder.encode(payload));
  if (!valid) return false;
  try { return JSON.parse(decodeBase64Url(payload)).exp > Date.now() / 1000; } catch { return false; }
}
