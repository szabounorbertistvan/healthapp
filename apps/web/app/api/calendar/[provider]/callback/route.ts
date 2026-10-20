// GET /api/calendar/<google|microsoft>/callback — where the provider sends the
// coach back. Checks the state against the cookie, trades the code (with the
// PKCE verifier) for tokens, opens or reopens the connection, stores the
// tokens ENCRYPTED (calendar_credentials, service role only) and runs the
// first sync at once so the coach sees their calendars. Back to
// /bookings/availability with ?calendar=connected | failed | denied.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { liveUser } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { calendarAdapter, calendarRedirectUri, currentTokenKey, tokenKeys } from "@/lib/calendar/registry";
import { decodePending, isCalendarProvider, OAUTH_COOKIE, stateMatches } from "@/lib/calendar/oauth";
import { serviceCalendarStore } from "@/lib/calendar/store";
import { syncConnection } from "@/lib/calendar/sync";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const url = new URL(request.url);
  const back = (status: string) => {
    const res = NextResponse.redirect(new URL(`/bookings/availability?calendar=${status}`, request.url));
    res.cookies.set(OAUTH_COOKIE, "", { path: "/api/calendar", maxAge: 0 });
    res.headers.set("Cache-Control", "no-store");
    return res;
  };

  const jar = await cookies();
  const pending = decodePending(jar.get(OAUTH_COOKIE)?.value);
  if (!isCalendarProvider(provider) || !pending || pending.provider !== provider) return back("failed");
  if (!stateMatches(pending.state, url.searchParams.get("state"))) return back("failed");
  if (url.searchParams.get("error")) return back("denied"); // the coach said no on the consent screen
  const code = url.searchParams.get("code");
  if (!code) return back("failed");

  const live = await liveUser();
  const adapter = calendarAdapter(provider);
  const db = supabaseService();
  const keys = tokenKeys();
  const writeKey = currentTokenKey();
  if (!live || !adapter || !db || !keys || !writeKey) return back("failed");

  try {
    const tokens = await adapter.exchangeCode({
      code,
      redirectUri: calendarRedirectUri(provider, url.origin),
      codeVerifier: pending.verifier,
    });
    const { data: connectionId, error } = await db.rpc("calendar_connection_open", {
      p_coach: live.userId, p_provider: provider, p_account_label: tokens.accountLabel, p_scopes: tokens.scopes,
    });
    if (error || typeof connectionId !== "string") return back("failed");
    const store = serviceCalendarStore(db, keys, writeKey);
    await store.saveInitial(connectionId, tokens);
    // the first sync now, so the screen shows the calendars; a failure is stored and retried by the worker
    await syncConnection(connectionId, { adapter, store });
    return back("connected");
  } catch {
    return back("failed");
  }
}
