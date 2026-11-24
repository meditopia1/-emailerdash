import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { adminCookieName, isValidAdminSession } from "./admin-auth";

export async function campaignApiGuard(request: Request) {
  const session = (await cookies()).get(adminCookieName())?.value;
  if (!isValidAdminSession(session)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const origin = request.headers.get("origin");
  if (request.method !== "GET" && (request.headers.get("sec-fetch-site") === "cross-site" || (origin && origin !== new URL(request.url).origin))) return NextResponse.json({ error: "Cross-origin writes are not allowed" }, { status: 403 });
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 1100000) return NextResponse.json({ error: "Campaign is too large" }, { status: 413 });
  return null;
}
