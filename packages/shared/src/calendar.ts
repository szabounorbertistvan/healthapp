/**
 * External calendars (20261111130000): the provider-agnostic rules, shared by
 * the server's sync worker and the coach's screen. Pure — tested in
 * calendar.test.ts.
 *
 * Privacy by construction: everything here works on busy *intervals*. No
 * type in this file has a field for an event's title, attendees, location or
 * description, so nothing downstream can store one by accident.
 */
import { addDays } from "./booking";

export const CALENDAR_PROVIDERS = ["google", "microsoft"] as const;
export type CalendarProvider = (typeof CALENDAR_PROVIDERS)[number];

/**
 * The least each provider must grant for "block my booking times when I'm
 * busy": the list of calendars (names, to let the coach choose) and
 * free/busy — never read access to events. Microsoft has no free/busy-only
 * scope: Calendars.ReadBasic is the narrowest (it excludes bodies and
 * attendees), and only busy intervals are kept from it.
 */
export const CALENDAR_PROVIDER_INFO: Record<CalendarProvider, { scopes: readonly string[]; revokesOnDisconnect: boolean }> = {
  google: {
    scopes: [
      "https://www.googleapis.com/auth/calendar.freebusy",
      "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
    ],
    revokesOnDisconnect: true,
  },
  microsoft: {
    scopes: ["offline_access", "Calendars.ReadBasic"],
    // Microsoft identity has no token-revocation endpoint for a single grant; the coach removes the app in their account
    revokesOnDisconnect: false,
  },
};

export type CalendarConnectionStatus = "pending" | "connected" | "syncing" | "error" | "reauth_required" | "disconnected";
export type CalendarErrorCode =
  | "token_expired" | "token_revoked" | "permission_denied" | "rate_limited" | "provider_unavailable" | "calendar_not_found" | "unknown";

/** Errors the coach must act on (reconnect) vs ones the worker retries. Same split as calendar_sync_failed(). */
export function needsReconnect(code: CalendarErrorCode): boolean {
  return code === "token_expired" || code === "token_revoked" || code === "permission_denied";
}

/** A busy interval, absolute instants (ISO strings with an offset, or Dates). */
export type BusyInterval = { start: Date; end: Date };

/**
 * The provider's busy intervals → what is stored: clipped to the window,
 * empty or inverted ones dropped, overlapping and touching ones merged, in
 * order. Fewer rows, and nothing outside what was asked.
 */
export function normalizeBusy(intervals: { start: Date | string; end: Date | string }[], window: BusyInterval): BusyInterval[] {
  const clipped = intervals
    .map((i) => ({ start: new Date(i.start), end: new Date(i.end) }))
    .filter((i) => !Number.isNaN(i.start.getTime()) && !Number.isNaN(i.end.getTime()))
    .map((i) => ({
      start: new Date(Math.max(i.start.getTime(), window.start.getTime())),
      end: new Date(Math.min(i.end.getTime(), window.end.getTime())),
    }))
    .filter((i) => i.end.getTime() > i.start.getTime())
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const out: BusyInterval[] = [];
  for (const i of clipped) {
    const last = out[out.length - 1];
    if (last && i.start.getTime() <= last.end.getTime()) {
      if (i.end.getTime() > last.end.getTime()) last.end = i.end;
    } else {
      out.push({ start: i.start, end: i.end });
    }
  }
  return out;
}

/**
 * The instant a wall-clock time in a zone is — "2026-10-25 00:00 in
 * Europe/Bucharest" — exact across DST (the offset is the zone's own at that
 * moment, found by correcting a first guess twice). A wall time that does not
 * exist (inside a spring-forward gap) resolves to the instant after the gap.
 */
export function zonedWallTimeToInstant(isoDate: string, time: string, timeZone: string): Date {
  const [h, m] = time.split(":").map(Number);
  const wallUtc = Date.parse(`${isoDate}T${String(h ?? 0).padStart(2, "0")}:${String(m ?? 0).padStart(2, "0")}:00Z`);
  const offsetAt = (t: number) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(new Date(t));
    const get = (k: string) => Number(parts.find((p) => p.type === k)?.value ?? 0);
    const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
    return asUtc - t;
  };
  let t = wallUtc - offsetAt(wallUtc);
  t = wallUtc - offsetAt(t);
  return new Date(t);
}

/**
 * An all-day event — [startDate, endDate) as calendar dates, the way both
 * providers return them — as the instants it covers in the calendar's zone.
 * A day is not 24 hours twice a year: the day DST ends is 25.
 */
export function allDayToInterval(startDate: string, endDateExclusive: string, timeZone: string): BusyInterval {
  return {
    start: zonedWallTimeToInstant(startDate, "00:00", timeZone),
    end: zonedWallTimeToInstant(endDateExclusive > startDate ? endDateExclusive : addDays(startDate, 1), "00:00", timeZone),
  };
}

/** How far ahead busy time is kept: what booking can reach (max advance is ≤ 365 days; the default 60). */
export const SYNC_WINDOW_DAYS = 90;

/** The window a sync reads: from the start of yesterday (UTC) for SYNC_WINDOW_DAYS. */
export function syncWindow(now: Date, days = SYNC_WINDOW_DAYS): BusyInterval {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  return { start, end: new Date(start.getTime() + (days + 1) * 86_400_000) };
}

/**
 * When to sync again without a push from the provider: a safety net, not a
 * polling loop — every 6 hours while push notifications work, every 30
 * minutes when a connection has no push channel.
 */
export function nextSafetySync(now: Date, hasPushChannel: boolean): Date {
  return new Date(now.getTime() + (hasPushChannel ? 6 * 60 : 30) * 60_000);
}

/** What the coach's screen says about a connection. */
export type CalendarConnectionView =
  | { state: "connected"; lastSyncedAt: string | null; stale: boolean }
  | { state: "syncing" | "pending" }
  | { state: "error"; code: CalendarErrorCode }
  | { state: "reauth_required"; code: CalendarErrorCode };

/** A connection that has not synced for a day is stale even when "connected": the screen says when it last did. */
export function calendarConnectionView(
  c: { status: CalendarConnectionStatus; last_synced_at: string | null; last_error_code: CalendarErrorCode | null },
  now = new Date(),
): CalendarConnectionView {
  switch (c.status) {
    case "connected":
      return {
        state: "connected", lastSyncedAt: c.last_synced_at,
        stale: !c.last_synced_at || now.getTime() - Date.parse(c.last_synced_at) > 24 * 3_600_000,
      };
    case "syncing":
    case "pending":
      return { state: c.status };
    case "reauth_required":
      return { state: "reauth_required", code: c.last_error_code ?? "token_expired" };
    case "error":
    default:
      return { state: "error", code: c.last_error_code ?? "unknown" };
  }
}
