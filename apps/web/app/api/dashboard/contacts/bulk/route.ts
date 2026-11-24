import { NextResponse } from "next/server";
import { z } from "zod";
import { campaignApiGuard } from "../../../../../lib/campaign-api";
import { audienceError } from "../../../../../lib/audience-server";
import { supabaseAdmin } from "../../../../../lib/supabase-admin";
export async function POST(request: Request) {
  const denied = await campaignApiGuard(request); if (denied) return denied;
  try {
    const body = z.object({ action: z.enum(["tag", "list", "remove_list", "archive", "restore", "suppress"]), ids: z.array(z.string().uuid()).min(1).max(1000), value: z.object({ tag: z.string().trim().min(1).max(50).optional(), list_id: z.string().uuid().optional() }).strict().optional().default({}) }).strict().parse(await request.json());
    const { data, error } = await supabaseAdmin({ writeTimeoutMs: 25000 }).rpc("mail_contact_bulk", { action: body.action, ids: [...new Set(body.ids)], value: body.value }); if (error) throw error;
    return NextResponse.json({ affected: data });
  } catch (error) { return audienceError(error, true); }
}
