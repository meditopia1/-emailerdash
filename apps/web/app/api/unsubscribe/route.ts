import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../lib/supabase-admin";

export async function GET(request: Request) {
  const url = new URL(request.url); const email = (url.searchParams.get("email") || "").trim().toLowerCase(); const token = url.searchParams.get("token") || ""; const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret || !email || !token) return new NextResponse("Invalid unsubscribe link.", { status: 400 });
  const expected = createHmac("sha256", secret).update(email).digest("base64url");
  if (expected.length !== token.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(token))) return new NextResponse("Invalid unsubscribe link.", { status: 400 });
  const { error } = await supabaseAdmin().from("mail_suppressions").upsert({ normalized_email: email, reason: "unsubscribed", source: "unsubscribe_link" }, { onConflict: "normalized_email" });
  if (error) return new NextResponse("We could not update your subscription. Try again later.", { status: 503 });
  return new NextResponse("You have been unsubscribed from future emails.", { headers: { "content-type": "text/plain; charset=utf-8" } });
}
