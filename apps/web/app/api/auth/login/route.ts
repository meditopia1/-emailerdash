import { NextResponse } from "next/server";
import { adminCookieName, createAdminSession, verifyAdminCredentials } from "../../../../lib/admin-auth";

export async function POST(request: Request) { const body = await request.json().catch(() => null) as { username?: string; password?: string } | null; if (!body?.username || !body.password || !verifyAdminCredentials(body.username, body.password)) return NextResponse.json({ error: "Invalid username or password" }, { status: 401 }); const response = NextResponse.json({ ok: true }); response.cookies.set(adminCookieName(), createAdminSession(), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 12 }); return response; }
