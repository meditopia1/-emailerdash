import { NextResponse } from "next/server";
import { z } from "zod";
import { campaignApiGuard } from "../../../../../lib/campaign-api";
import { audienceError } from "../../../../../lib/audience-server";
import { selectionSchema } from "../../../../../lib/audience-schema";
import { supabaseAdmin } from "../../../../../lib/supabase-admin";
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview"), selection: selectionSchema, contact_ids: z.array(z.string().uuid()).max(1000).optional().default([]) }).strict(),
  z.object({ action: z.literal("approve"), campaign_id: z.string().uuid(), expected_revision: z.number().int().min(0), fingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
]);
export async function POST(request: Request) {
  const denied = await campaignApiGuard(request); if (denied) return denied;
  let isApproval = false;
  try {
    const body = schema.parse(await request.json()); isApproval = body.action === "approve"; const db = supabaseAdmin({ writeTimeoutMs: 25000 });
    let result;
    if (body.action === "approve") {
      result = await db.rpc("mail_approve_campaign_audience", { target: body.campaign_id, expected_revision: body.expected_revision, expected_hash: body.fingerprint });
    } else {
      result = await db.rpc("mail_preview_campaign_audience", { selection: body.selection, individual_ids: body.contact_ids });
      if (result.error && isTransientAudienceFailure(result.error)) {
        result = await db.rpc("mail_preview_campaign_audience", { selection: body.selection, individual_ids: body.contact_ids });
      }
    }
    if (result.error) throw result.error;
    return NextResponse.json(result.data, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return audienceError(error, isApproval); }
}

function isTransientAudienceFailure(error: unknown) {
  const issue = error as { code?: string; status?: number };
  return (issue.status ?? 0) >= 500 || ["08000", "08003", "08006", "57P01"].includes(issue.code ?? "");
}

