import { NextRequest, NextResponse } from "next/server";
import { campaignApiGuard } from "../../../../../../lib/campaign-api";
import { isUuid } from "../../../../../../lib/campaign-builder";
import { supabaseAdmin } from "../../../../../../lib/supabase-admin";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await campaignApiGuard(request); if (denied) return denied;
  const { id } = await params; if (!isUuid(id)) return NextResponse.json({ error: "Invalid campaign ID" }, { status: 400 });
  const page = Math.max(0, Math.min(10000, Number(request.nextUrl.searchParams.get("page")) || 0));
  const metric = request.nextUrl.searchParams.get("metric") ?? "recipients";
  const eventMetrics = ["opened", "clicked", "bounced", "unsubscribed", "complained"];
  if (!["recipients", "accepted", "delivered", "failed", "blocked", ...eventMetrics].includes(metric)) return NextResponse.json({ error: "Invalid activity filter" }, { status: 400 });
  try {
    const db = supabaseAdmin();
    if (eventMetrics.includes(metric)) {
      const { data, count, error } = await db.from("mail_events").select("id,email,event_type,event_at,recipient_id", { count: "exact" }).eq("campaign_id", id).in("event_type", [metric, `email.${metric}`]).order("event_at", { ascending: false }).range(page * 25, page * 25 + 24);
      if (error) throw error;
      return NextResponse.json({ kind: "events", rows: data ?? [], count: count ?? 0, page });
    }
    let query = db.from("mail_recipients").select("id,email,name,status,provider_message_id,error_message,last_error,accepted_at,delivered_at,latest_event_at", { count: "exact" }).eq("campaign_id", id);
    if (metric === "accepted") query = query.not("accepted_at", "is", null);
    if (metric === "delivered") query = query.not("delivered_at", "is", null);
    if (metric === "failed" || metric === "blocked") query = query.eq("status", metric);
    const { data, error, count } = await query.order("id").range(page * 25, page * 25 + 24);
    if (error) throw error;
    return NextResponse.json({ kind: "recipients", rows: data ?? [], count: count ?? 0, page });
  } catch { return NextResponse.json({ error: "Campaign activity unavailable" }, { status: 500 }); }
}
