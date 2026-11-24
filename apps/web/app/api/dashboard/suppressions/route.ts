import { NextResponse } from "next/server";
import { z } from "zod";
import { campaignApiGuard } from "../../../../lib/campaign-api";
import { supabaseAdmin } from "../../../../lib/supabase-admin";

const cursorSchema = z.object({ at: z.string().datetime({ offset: true }), id: z.string().uuid() }).strict();
export async function GET(request: Request) {
  const denied = await campaignApiGuard(request); if (denied) return denied;
  try {
    const params = new URL(request.url).searchParams;
    const search = z.string().trim().max(200).parse(params.get("q") ?? "");
    const raw = params.get("cursor");
    if (raw && raw.length > 500) return NextResponse.json({ error: "Invalid page cursor. Reload the suppression list." }, { status: 400 });
    const cursor = raw ? cursorSchema.parse(JSON.parse(Buffer.from(raw, "base64url").toString("utf8"))) : null;
    let query = supabaseAdmin().from("mail_suppressions").select("id,normalized_email,reason,source,created_at").order("created_at", { ascending: false }).order("id", { ascending: false }).limit(51);
    if (search) query = query.ilike("normalized_email", `%${search.replace(/[\\%_]/g, "\\$&")}%`);
    if (cursor) query = query.or(`created_at.lt.${cursor.at},and(created_at.eq.${cursor.at},id.lt.${cursor.id})`);
    const { data, error } = await query;
    if (error) return NextResponse.json({ error: "Suppression records could not be loaded. Keep existing safeguards in place and try Refresh again." }, { status: 503 });
    const rows = (data ?? []).slice(0, 50); const last = rows.at(-1);
    const next_cursor = data && data.length > 50 && last ? Buffer.from(JSON.stringify({ at: last.created_at, id: last.id })).toString("base64url") : null;
    return NextResponse.json({ rows, next_cursor }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof z.ZodError || error instanceof SyntaxError ? "Use a search of 200 characters or fewer and a valid page cursor. Reload the list to start again." : "Suppression records are unavailable. Try Refresh again." }, { status: error instanceof z.ZodError || error instanceof SyntaxError ? 400 : 503 });
  }
}
