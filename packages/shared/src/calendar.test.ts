import { describe, expect, it } from "vitest";
import {
  CALENDAR_PROVIDER_INFO, allDayToInterval, calendarConnectionView, needsReconnect, nextSafetySync, normalizeBusy, syncWindow,
  zonedWallTimeToInstant,
} from "./calendar";

const at = (s: string) => new Date(s);

describe("minimum permissions", () => {
  it("Google: free/busy and the calendar list — never events", () => {
    expect(CALENDAR_PROVIDER_INFO.google.scopes).toEqual([
      "https://www.googleapis.com/auth/calendar.freebusy",
      "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
    ]);
    for (const s of CALENDAR_PROVIDER_INFO.google.scopes) expect(s).not.toMatch(/calendar(\.events)?(\.readonly)?$/);
  });
  it("Microsoft: the narrowest read scope, no write", () => {
    expect(CALENDAR_PROVIDER_INFO.microsoft.scopes).toEqual(["offline_access", "Calendars.ReadBasic"]);
    expect(CALENDAR_PROVIDER_INFO.microsoft.scopes.join(" ")).not.toMatch(/ReadWrite|Calendars\.Read\b(?!Basic)/);
  });
});

describe("busy intervals", () => {
  const window = { start: at("2026-11-02T00:00:00Z"), end: at("2026-11-03T00:00:00Z") };
  it("clips to the window, merges overlaps and touching ones, sorts", () => {
    expect(normalizeBusy([
      { start: "2026-11-02T10:00:00Z", end: "2026-11-02T11:00:00Z" },
      { start: "2026-11-01T22:00:00Z", end: "2026-11-02T01:00:00Z" },
      { start: "2026-11-02T10:30:00Z", end: "2026-11-02T12:00:00Z" },
      { start: "2026-11-02T12:00:00Z", end: "2026-11-02T12:30:00Z" },
      { start: "2026-11-02T23:30:00Z", end: "2026-11-03T02:00:00Z" },
    ], window)).toEqual([
      { start: at("2026-11-02T00:00:00Z"), end: at("2026-11-02T01:00:00Z") },
      { start: at("2026-11-02T10:00:00Z"), end: at("2026-11-02T12:30:00Z") },
      { start: at("2026-11-02T23:30:00Z"), end: at("2026-11-03T00:00:00Z") },
    ]);
  });
  it("drops empty, inverted, unreadable and out-of-window intervals", () => {
    expect(normalizeBusy([
      { start: "2026-11-02T10:00:00Z", end: "2026-11-02T10:00:00Z" },
      { start: "2026-11-02T11:00:00Z", end: "2026-11-02T10:00:00Z" },
      { start: "not a date", end: "2026-11-02T10:00:00Z" },
      { start: "2026-11-05T10:00:00Z", end: "2026-11-05T11:00:00Z" },
    ], window)).toEqual([]);
  });
  it("reads offsets as instants: 10:00+02:00 is 08:00Z", () => {
    expect(normalizeBusy([{ start: "2026-11-02T10:00:00+02:00", end: "2026-11-02T11:00:00+02:00" }], window))
      .toEqual([{ start: at("2026-11-02T08:00:00Z"), end: at("2026-11-02T09:00:00Z") }]);
  });
});

describe("time zones and DST", () => {
  it("a wall time is the zone's own instant, summer and winter", () => {
    expect(zonedWallTimeToInstant("2026-07-01", "10:00", "Europe/Bucharest").toISOString()).toBe("2026-07-01T07:00:00.000Z");
    expect(zonedWallTimeToInstant("2026-12-01", "10:00", "Europe/Bucharest").toISOString()).toBe("2026-12-01T08:00:00.000Z");
    expect(zonedWallTimeToInstant("2026-12-01", "10:00", "America/New_York").toISOString()).toBe("2026-12-01T15:00:00.000Z");
  });
  it("the day DST ends is 25 hours long (Bucharest, 25 Oct 2026)", () => {
    const day = allDayToInterval("2026-10-25", "2026-10-26", "Europe/Bucharest");
    expect(day.start.toISOString()).toBe("2026-10-24T21:00:00.000Z");
    expect(day.end.toISOString()).toBe("2026-10-25T22:00:00.000Z");
    expect((day.end.getTime() - day.start.getTime()) / 3_600_000).toBe(25);
  });
  it("the day DST starts is 23 hours long (Bucharest, 29 Mar 2026)", () => {
    const day = allDayToInterval("2026-03-29", "2026-03-30", "Europe/Bucharest");
    expect((day.end.getTime() - day.start.getTime()) / 3_600_000).toBe(23);
  });
  it("a wall time inside the spring-forward gap lands after it", () => {
    // 03:30 does not exist in Bucharest on 29 Mar 2026 (03:00 → 04:00)
    expect(zonedWallTimeToInstant("2026-03-29", "03:30", "Europe/Bucharest").toISOString()).toBe("2026-03-29T01:30:00.000Z");
  });
  it("a multi-day all-day event, and a zero-length one counted as one day", () => {
    const trip = allDayToInterval("2026-11-02", "2026-11-05", "Europe/Bucharest");
    expect((trip.end.getTime() - trip.start.getTime()) / 86_400_000).toBe(3);
    const odd = allDayToInterval("2026-11-02", "2026-11-02", "UTC");
    expect(odd.end.toISOString()).toBe("2026-11-03T00:00:00.000Z");
  });
});

describe("sync rhythm and status", () => {
  it("a window from yesterday, a safety net that is not a polling loop", () => {
    const w = syncWindow(at("2026-11-02T15:00:00Z"), 90);
    expect(w.start.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect((w.end.getTime() - w.start.getTime()) / 86_400_000).toBe(91);
    expect(nextSafetySync(at("2026-11-02T15:00:00Z"), true).toISOString()).toBe("2026-11-02T21:00:00.000Z");
    expect(nextSafetySync(at("2026-11-02T15:00:00Z"), false).toISOString()).toBe("2026-11-02T15:30:00.000Z");
  });
  it("credentials refused need the coach; everything else is retried", () => {
    expect(needsReconnect("token_revoked")).toBe(true);
    expect(needsReconnect("permission_denied")).toBe(true);
    expect(needsReconnect("rate_limited")).toBe(false);
    expect(needsReconnect("provider_unavailable")).toBe(false);
  });
  it("the screen's view of a connection", () => {
    const now = at("2026-11-02T15:00:00Z");
    expect(calendarConnectionView({ status: "connected", last_synced_at: "2026-11-02T14:00:00Z", last_error_code: null }, now))
      .toEqual({ state: "connected", lastSyncedAt: "2026-11-02T14:00:00Z", stale: false });
    expect(calendarConnectionView({ status: "connected", last_synced_at: "2026-10-30T14:00:00Z", last_error_code: null }, now))
      .toMatchObject({ state: "connected", stale: true });
    expect(calendarConnectionView({ status: "reauth_required", last_synced_at: null, last_error_code: "token_revoked" }, now))
      .toEqual({ state: "reauth_required", code: "token_revoked" });
    expect(calendarConnectionView({ status: "error", last_synced_at: null, last_error_code: null }, now))
      .toEqual({ state: "error", code: "unknown" });
  });
});
