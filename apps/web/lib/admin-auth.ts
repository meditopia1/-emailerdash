import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const cookieName = "marketing_os_admin";
const sessionTtlSeconds = 60 * 60 * 12;
function secret() { return process.env.ADMIN_SESSION_SECRET ?? ""; }
function sign(value: string) { return createHmac("sha256", secret()).update(value).digest("base64url"); }

export function verifyAdminCredentials(username: string, password: string) {
  const configuredUsername = process.env.ADMIN_USERNAME;
  const encoded = process.env.ADMIN_PASSWORD_HASH;
  if (!configuredUsername || !encoded || !secret()) return false;
  const [salt, expected] = encoded.split(":");
  if (!salt || !expected || username !== configuredUsername) return false;
  const actual = scryptSync(password, salt, 32); const expectedBuffer = Buffer.from(expected, "base64url");
  return actual.length === expectedBuffer.length && timingSafeEqual(actual, expectedBuffer);
}

export function createAdminSession() { const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + sessionTtlSeconds, nonce: randomBytes(8).toString("hex") })).toString("base64url"); return `${payload}.${sign(payload)}`; }
export function isValidAdminSession(value: string | undefined) { if (!value || !secret()) return false; const [payload, signature] = value.split("."); if (!payload || !signature || sign(payload) !== signature) return false; try { return JSON.parse(Buffer.from(payload, "base64url").toString()).exp > Date.now() / 1000; } catch { return false; } }
export function adminCookieName() { return cookieName; }
export function passwordHash(password: string) { const salt = randomBytes(16).toString("base64url"); return `${salt}:${scryptSync(password, salt, 32).toString("base64url")}`; }
