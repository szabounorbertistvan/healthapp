// GET /api/cron/calendar-sync — the calendar sync worker, called on a schedule
// (Supabase pg_cron + pg_net, or Vercel Cron) with
//   Authorization: Bearer <CALENDAR_CRON_SECRET>
// It takes the connections that are due (calendar_connections_due marks them
// syncing, skip locked — two runs never take the same one), syncs each through
// syncConnection, then revokes the tokens of disconnected connections and
// purges them. Answers counts only; never a token, an event or a provider's text.
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { CALENDAR_PROVIDER_INFO, type CalendarProvider } from "@healthapp/shared";
import { supabaseService } from "@/lib/supabase/service";
import { calendarAdapter, currentTokenKey, tokenKeys } from "@/lib/calendar/registry";
import { serviceCalendarStore } from "@/lib/calendar/store";
import { syncConnection } from "@/lib/calendar/sync";
import { decryptToken } from "@/lib/calendar/token-crypto";

export const runtime = "nodejs";
export const maxDuration = 60;

function authorized(request: Request): boolean {
  const secret = process.env.CALENDAR_CRON_SECRET?.trim() || process.env.CRON_SECRET?.trim();
  const got = request.headers.get("authorization") ?? "";
  if (!secret) return false;
  const a = Buffer.from(`Bearer ${secret}`);
  const b = Buffer.from(got);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = supabaseService();
  const keys = tokenKeys();
  const writeKey = currentTokenKey();
  if (!db || !keys || !writeKey) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  const store = serviceCalendarStore(db, keys, writeKey);

  let synced = 0;
  let failed = 0;
  const { data: due } = await db.rpc("calendar_connections_due", { p_limit: 20 });
  for (const row of (due ?? []) as { connection_id: string; provider: CalendarProvider }[]) {
    const adapter = calendarAdapter(row.provider);
    if (!adapter) {
      await store.fail(row.connection_id, "provider_unavailable", new Date(Date.now() + 60 * 60_000));
      failed++;
      continue;
    }
    const outcome = await syncConnection(row.connection_id, { adapter, store });
    if (outcome.ok) synced++; else failed++;
  }

  // disconnected: revoke at the provider (best effort), then forget the tokens
  let revoked = 0;
  const { data: pendingRevoke } = await db
    .from("calendar_connections")
    .select("id, provider")
    .eq("status", "disconnected")
    .eq("revoke_pending", true)
    .limit(20);
  for (const c of (pendingRevoke ?? []) as { id: string; provider: CalendarProvider }[]) {
    const adapter = calendarAdapter(c.provider);
    if (adapter && CALENDAR_PROVIDER_INFO[c.provider].revokesOnDisconnect) {
      const { data: cred } = await db.from("calendar_credentials").select("refresh_token_enc, access_token_enc").eq("connection_id", c.id).maybeSingle();
      const stored = cred?.refresh_token_enc ?? cred?.access_token_enc;
      if (stored) {
        try {
          await adapter.revoke(decryptToken(stored, keys, c.id));
        } catch {
          // a token that cannot be read cannot be revoked; it is purged all the same
        }
      }
    }
    await db.rpc("calendar_credentials_revoked", { p_connection: c.id });
    revoked++;
  }

  return NextResponse.json({ synced, failed, revoked }, { headers: { "Cache-Control": "no-store" } });
}
