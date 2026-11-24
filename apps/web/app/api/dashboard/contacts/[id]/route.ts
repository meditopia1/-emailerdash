import { NextResponse } from "next/server";
import { z } from "zod";
import { campaignApiGuard } from "../../../../../lib/campaign-api";
import { audienceError, customDefinitions } from "../../../../../lib/audience-server";
import { contactInputSchema, validateCustomValues } from "../../../../../lib/audience-schema";
import { supabaseAdmin } from "../../../../../lib/supabase-admin";
import { storedClickUrl } from "../../../../../lib/dashboard-read-model";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  const denied = await campaignApiGuard(request); if (denied) return denied;
  try {
    const id = z.string().uuid().parse((await context.params).id); const params = new URL(request.url).searchParams;
    const page = z.coerce.number().int().min(0).max(10000).parse(params.get("page") ?? 0);
    const { data, error } = await supabaseAdmin().rpc("mail_contact_profile", { target: id, page_number: page }, { get: true });
    if (error) throw error; if (!data) return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    const events = data.events as Array<Record<string, unknown> & { payload?: unknown }>;
    const activities = events.slice(0, 25).map(({ payload, ...event }) => ({ ...event, clicked_url: storedClickUrl(payload) }));
    return NextResponse.json({ ...data, events: activities, consents: data.consents.slice(0, 25), history: data.history.slice(0, 25), recipient_campaigns: data.recipient_campaigns.slice(0, 25), more: { events: events.length > 25, consents: data.consents.length > 25, history: data.history.length > 25, recipients: data.recipient_campaigns.length > 25 } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return audienceError(error); }
}
export async function PATCH(request: Request, context: Context) {
  const denied = await campaignApiGuard(request); if (denied) return denied;
  try {
    const id = z.string().uuid().parse((await context.params).id); const parsed = contactInputSchema.parse(await request.json());
    if (Object.keys(parsed.custom_fields).length > 0) validateCustomValues(parsed.custom_fields, await customDefinitions());
    const { data, error } = await supabaseAdmin({ writeTimeoutMs: 25000 }).rpc("mail_contact_save", { payload: parsed, target: id }); if (error) throw error;
    return NextResponse.json({ id: data });
  } catch (error) { return audienceError(error, true); }
}
