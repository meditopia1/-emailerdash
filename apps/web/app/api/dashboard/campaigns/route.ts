import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabase-admin";
import { campaignApiGuard } from "../../../../lib/campaign-api";
import { campaignColumns, draftSchema } from "../../../../lib/campaign-builder";
import { resolveCampaignAudience } from "../../../../lib/campaign-audience";
import { integrationFailure, resolveDraftSender } from "../../../../lib/resend-integration";

export async function POST(request: NextRequest) {
  const denied = await campaignApiGuard(request); if (denied) return denied;
  try {
    const parsed = draftSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid campaign" }, { status: 400 });
    const body = parsed.data;
    const db = supabaseAdmin({ writeTimeoutMs: 25000 }); const settings = await resolveDraftSender(db, body.from_email);
    const audience = await resolveCampaignAudience(db, body.audience_contact_ids);
    if (audience.missing) return NextResponse.json({ error: "Some selected contacts no longer exist. Recheck the audience." }, { status: 400 });
    const { content_format, ...draft } = body;
    const { data, error } = await db.from("mail_campaigns").insert({ ...draft, sender_name: body.sender_name ?? settings.sender_name, from_email: settings.from_email, reply_to: body.reply_to ?? settings.reply_to, preheader: body.preheader || null, content_text: content_format === "text" ? body.content_text : null, content_html: content_format === "html" ? body.content_html : null, audience_contact_ids: [...new Set(body.audience_contact_ids)], status: "draft" }).select(campaignColumns).single();
    if (error) return NextResponse.json({ error: "Campaign save was not confirmed. Check your campaigns before trying again." }, { status: 503 });
    return NextResponse.json(data, { status: 201 });
  } catch (error) { return integrationFailure(error); }
}
