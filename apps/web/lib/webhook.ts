import { createHmac, timingSafeEqual } from "node:crypto";

/** Svix wire format: HMAC over ID.timestamp.original-body, with a decoded whsec_ key. */
export function verifyWebhookSignature(rawBody: string, headers: { id: string; timestamp: string; signature: string }, secret: string, now = Date.now()) {
  if (!/^whsec_[A-Za-z0-9+/=_-]+$/.test(secret) || !headers.id || headers.id.length > 200 || !/^\d{1,12}$/.test(headers.timestamp)) return false;
  if (Math.abs(now / 1000 - Number(headers.timestamp)) > 300 || headers.signature.length > 4000) return false;
  const key = Buffer.from(secret.slice(6), "base64"); if (key.length < 16) return false;
  const expected = createHmac("sha256", key).update(`${headers.id}.${headers.timestamp}.${rawBody}`).digest();
  return headers.signature.split(" ").some(signature => {
    const [version, value] = signature.split(","); if (version !== "v1" || !value) return false;
    const received = Buffer.from(value, "base64");
    return expected.length === received.length && timingSafeEqual(expected, received);
  });
}
