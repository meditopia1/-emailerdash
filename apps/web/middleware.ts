import { NextRequest, NextResponse } from "next/server";
import { isValidAdminSessionEdge } from "./lib/edge-auth";

export async function middleware(request: NextRequest) { const { pathname } = request.nextUrl; if (pathname === "/login" || pathname.startsWith("/api/auth/") || pathname.startsWith("/api/webhooks/") || pathname === "/unsubscribe") return NextResponse.next(); if (await isValidAdminSessionEdge(request.cookies.get("marketing_os_admin")?.value, process.env.ADMIN_SESSION_SECRET)) return NextResponse.next(); if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); return NextResponse.redirect(new URL("/login", request.url)); }
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
