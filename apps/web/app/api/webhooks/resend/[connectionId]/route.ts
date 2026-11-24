import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { z } from "zod";
import { verifyWebhookSignature } from "../../../../../lib/webhook";
import { integrationSettings, webhookCredential } from "../../../../../lib/resend-integration";
import { supabaseAdmin } from "../../../../../lib/supabase-admin";

const eventSchema = z.object({ type: z.string().max(100), created_at: z.string().datetime({ offset: true }), data: z.object({ email_id: z.string().min(1).max(200), bounce: z.object({ type: z.string().max(80).optional(), subType: z.string().max(80).optional() }).optional() }) });
const kinds = new Set(["sent", "delivered", "opened", "clicked", "bounced", "complained", "failed", "delivery_delayed", "suppressed"]);

async function rawPayload(request: Request) {
  const reader = request.body?.getReader(); if (!reader) return "";
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 1000000) { await reader.cancel(); throw new Error("large"); } chunks.push(value); }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString("utf8");
}

export async function POST(request: Request, { params }: { params: Promise<{ connectionId: string }> }) {
  const { connectionId } = await params;
  if (connectionId !== "default") return NextResponse.json({ error: "Unknown connection" }, { status: 404 });
  if (Number(request.headers.get("content-length") || 0) > 1000000) return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  let rawBody: string; try { rawBody = await rawPayload(request); } catch { return NextResponse.json({ error: "Payload too large or incomplete" }, { status: 413 }); }
  try {
    const settings = await integrationSettings(); const secret = webhookCredential(settings);
    if (!secret) return NextResponse.json({ error: "Webhook signing is not configured" }, { status: 503 });
    const headers = { id: request.headers.get("svix-id") || "", timestamp: request.headers.get("svix-timestamp") || "", signature: request.headers.get("svix-signature") || "" };
    const db = supabaseAdmin();
    if (!verifyWebhookSignature(rawBody, headers, secret)) {
      const { data: permitted } = await db.rpc("mail_integration_rate_limit", { target_bucket: "webhook_failure_audit", max_attempts: 10, window_seconds: 60 });
      if (permitted) await db.from("mail_integration_audit").insert({ action: "webhook_signature", entity_id: createHash("sha256").update(`${headers.id}.${headers.signature}`).digest("hex"), outcome: "rejected" });
      return NextResponse.json({ error: "Invalid signature or expired timestamp" }, { status: 401 });
    }
    let decoded: unknown; try { decoded = JSON.parse(rawBody); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
    const type = z.object({ type: z.string() }).safeParse(decoded);
    if (!type.success || !type.data.type.startsWith("email.") || !kinds.has(type.data.type.slice(6))) return NextResponse.json({ ignored: true });
    const parsed = eventSchema.safeParse(decoded);
    if (!parsed.success) return NextResponse.json({ error: "Invalid event payload" }, { status: 400 });
    const event = parsed.data;
    const { data, error } = await db.rpc("record_mail_provider_event", { event_id: headers.id, message_id: event.data.email_id, event_kind: event.type.slice(6), happened_at: event.created_at, metadata: event.data.bounce?.type ? { bounce_type: event.data.bounce.type } : {} });
    if (error) return NextResponse.json({ error: "Could not persist event. Retry delivery." }, { status: 503 });
    // Unknown IDs never attach to client-supplied campaign/recipient IDs. Retry covers send/persist races.
    if (data === "unmatched") return NextResponse.json({ error: "Provider message is not yet associated with this application. Retry delivery." }, { status: 503 });
    return NextResponse.json({ accepted: true, outcome: data });
  } catch { return NextResponse.json({ error: "Webhook configuration or storage unavailable" }, { status: 503 }); }
}
