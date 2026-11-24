import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { campaignApiGuard } from "../../../../../lib/campaign-api";
import { campaignColumns, draftSchema, isUuid, layoutSchema } from "../../../../../lib/campaign-builder";
import { resolveCampaignAudience } from "../../../../../lib/campaign-audience";
import { supabaseAdmin } from "../../../../../lib/supabase-admin";
import { integrationFailure, resolveDraftSender } from "../../../../../lib/resend-integration";
import { campaignCapabilities } from "../../../../../lib/campaign-capabilities";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Context) {
  const denied = await campaignApiGuard(request); if (denied) return denied;
  const { id } = await params; if (!isUuid(id)) return NextResponse.json({ error: "Invalid campaign ID" }, { status: 400 });
  try {
    const db = supabaseAdmin();
    const { data: campaign, error } = await db.from("mail_campaigns").select(campaignColumns).eq("id", id).maybeSingle();
    if (error) return NextResponse.json({ error: "Campaign unavailable" }, { status: 500 });
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    const audienceResult = await db.rpc("mail_preview_campaign_audience", { selection: campaign.audience_selection ?? { type: "contacts" }, individual_ids: campaign.audience_contact_ids ?? [] });
    if (audienceResult.error) return NextResponse.json({ error: "Audience eligibility could not be rechecked. Refresh the campaign and try again." }, { status: 503 });
    const audience = audienceResult.data;
    const recipientsResult = await db.from("mail_recipients").select("id,email,name,status,error_message,accepted_at,delivered_at,latest_event_at").eq("campaign_id", id).order("email").limit(1000);
    if (recipientsResult.error) return NextResponse.json({ error: "Campaign recipients could not be loaded" }, { status: 503 });
    const approval = await db.from("mail_campaign_audience_approvals").select("id,eligible_count,excluded_count,approved_at,fingerprint").eq("campaign_id", id).eq("campaign_revision", campaign.revision).order("approved_at", { ascending: false }).limit(1).maybeSingle();
    if (approval.error) return NextResponse.json({ error: "Audience approval could not be loaded. Try opening this draft again." }, { status: 503 });
    return NextResponse.json({ campaign, audience, recipients: recipientsResult.data ?? [], audience_approval: approval.data, capabilities: campaignCapabilities });
  } catch { return NextResponse.json({ error: "Campaign details could not be loaded" }, { status: 500 }); }
}

const patchSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("layout"), expected_revision: z.number().int().min(0), layout: layoutSchema }).strict(),
  z.object({ kind: z.literal("draft"), expected_revision: z.number().int().min(0), draft: draftSchema }).strict(),
  z.object({ kind: z.literal("launch"), expected_revision: z.number().int().min(0), confirmed: z.literal(true) }).strict(),
]);

export async function PATCH(request: NextRequest, { params }: Context) {
  const denied = await campaignApiGuard(request); if (denied) return denied;
  const { id } = await params; if (!isUuid(id)) return NextResponse.json({ error: "Invalid campaign ID" }, { status: 400 });
  try {
    const parsed = patchSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid campaign update" }, { status: 400 });
    const body = parsed.data; const db = supabaseAdmin({ writeTimeoutMs: 25000 });
    const { data: current, error: currentError } = await db.from("mail_campaigns").select("id,status,revision,layout_revision,from_email").eq("id", id).maybeSingle();
    if (currentError) return NextResponse.json({ error: "Campaign unavailable" }, { status: 500 });
    if (!current) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    if (body.kind === "launch") {
      const { data: launched, error: launchError } = await db.rpc("mail_launch_campaign", { target: id, expected_revision: body.expected_revision });
      if (launchError) return integrationFailure(launchError);
      const { data: campaign, error } = await db.from("mail_campaigns").select(campaignColumns).eq("id", id).single();
      if (error || !campaign) return NextResponse.json({ error: "Campaign launched, but its status could not be reloaded. Check Active Sending." }, { status: 503 });
      return NextResponse.json({ campaign, queued: launched?.queued ?? campaign.total_count });
    }
    if (body.kind === "layout") {
      const { data, error } = await db.from("mail_campaigns").update({ workflow_layout: body.layout }).eq("id", id).eq("layout_revision", body.expected_revision).select("id,workflow_layout,layout_revision").maybeSingle();
      if (error) return NextResponse.json({ error: "Could not save workflow layout" }, { status: 500 });
      if (!data) return NextResponse.json({ error: "This layout changed in another session. Reload the saved layout before saving again." }, { status: 409 });
      return NextResponse.json(data);
    }
    if (current.status !== "draft" || current.revision !== body.expected_revision) return NextResponse.json({ error: "This campaign changed in another session or is no longer a draft. Your local changes have been kept." }, { status: 409 });
    const draft = body.draft;
    const settings = await resolveDraftSender(db, draft.from_email, current.from_email);
    const audience = await resolveCampaignAudience(db, draft.audience_contact_ids);
    if (audience.missing) return NextResponse.json({ error: "Some selected contacts no longer exist. Recheck the audience." }, { status: 400 });
    const { content_format, ...fields } = draft;
    const { data, error } = await db.from("mail_campaigns").update({ ...fields, sender_name: draft.sender_name ?? settings.sender_name, from_email: settings.from_email, reply_to: draft.reply_to ?? settings.reply_to, preheader: draft.preheader || null, content_text: content_format === "text" ? draft.content_text : null, content_html: content_format === "html" ? draft.content_html : null, audience_contact_ids: [...new Set(draft.audience_contact_ids)] }).eq("id", id).eq("status", "draft").eq("revision", body.expected_revision).select(campaignColumns).maybeSingle();
    if (error) return NextResponse.json({ error: "Could not save campaign" }, { status: 500 });
    if (!data) return NextResponse.json({ error: "This campaign was updated elsewhere. Your local changes have been kept." }, { status: 409 });
    return NextResponse.json(data);
  } catch (error) { return integrationFailure(error); }
}
