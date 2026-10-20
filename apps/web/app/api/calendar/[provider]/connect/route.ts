// GET /api/calendar/<google|microsoft>/connect — the coach's "Connect" button.
// Starts the provider's consent screen with the narrowest scopes, an
// anti-forgery state and PKCE; the state and verifier wait in a short-lived
// httpOnly cookie for the callback. Signed-in coaches only (middleware asks
// for a session; calendar_connection_open refuses a non-coach later anyway).
import { NextResponse } from "next/server";
import { liveUser } from "@/lib/supabase/server";
import { calendarAdapter, calendarRedirectUri } from "@/lib/calendar/registry";
import { encodePending, isCalendarProvider, newOAuthPending, OAUTH_COOKIE, OAUTH_COOKIE_MAX_AGE } from "@/lib/calendar/oauth";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const back = new URL("/bookings/availability", request.url);
  if (!isCalendarProvider(provider)) return NextResponse.redirect(back);
  const adapter = calendarAdapter(provider);
  if (!adapter) return NextResponse.redirect(new URL("?calendar=unavailable", back));
  if (!(await liveUser())) return NextResponse.redirect(new URL("/login", request.url));

  const pending = newOAuthPending(provider);
  const url = adapter.authorizationUrl({
    state: pending.state,
    redirectUri: calendarRedirectUri(provider, new URL(request.url).origin),
    codeChallenge: pending.challenge,
  });
  const res = NextResponse.redirect(url);
  res.cookies.set(OAUTH_COOKIE, encodePending(pending), {
    httpOnly: true, secure: true, sameSite: "lax", path: "/api/calendar", maxAge: OAUTH_COOKIE_MAX_AGE,
  });
  res.headers.set("Cache-Control", "no-store");
  return res;
}
