import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Mirrors SESSION_COOKIE in lib/api/session (kept inline: middleware runs on
// the Edge runtime where next/headers is unavailable).
const SESSION_COOKIE = "alk_session";

/**
 * Gate every page behind a session cookie.
 * /login and /register stay public; Next.js internals and static assets pass through.
 */
export function middleware(req: NextRequest) {
  if (!req.cookies.get(SESSION_COOKIE)?.value) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!login|register|_next|favicon.ico).*)"],
};
