import { describe, expect, it } from "vitest";
import type { BusyInterval } from "@healthapp/shared";
import { CalendarProviderError, type CalendarProviderAdapter, type ExternalCalendar, type TokenSet } from "./provider";
import { syncConnection, type CalendarSyncStore, type StoredCredentials } from "./sync";

// A test double of the provider contract — never used outside this file.
function adapter(over: Partial<CalendarProviderAdapter> = {}) {
  const calls: string[] = [];
  const calendars: ExternalCalendar[] = [
    { id: "primary", name: "Work", primary: true, timeZone: "Europe/Bucharest" },
    { id: "family", name: "Family", primary: false, timeZone: "Europe/Bucharest" },
  ];
  const a: CalendarProviderAdapter = {
    provider: "google",
    authorizationUrl: () => "https://example.test/auth",
    exchangeCode: async () => { throw new Error("unused"); },
    refresh: async () => { calls.push("refresh"); return { accessToken: "fresh", expiresAt: new Date("2026-11-02T16:00:00Z"), scopes: [] }; },
    listCalendars: async (token) => { calls.push(`list:${token}`); return calendars; },
    freeBusy: async (token, ids, window: BusyInterval) => {
      calls.push(`freebusy:${token}:${ids.join(",")}`);
      return ids.map((id) => ({
        calendarId: id,
        busy: [
          { start: new Date("2026-11-03T10:00:00Z"), end: new Date("2026-11-03T11:00:00Z") },
          { start: new Date("2026-11-03T10:30:00Z"), end: new Date("2026-11-03T12:00:00Z") },
          { start: new Date(window.end.getTime() + 3_600_000), end: new Date(window.end.getTime() + 7_200_000) },
        ],
      }));
    },
    revoke: async () => undefined,
    ...over,
  };
  return { a, calls };
}

function store(creds: StoredCredentials | null, affecting: string[] = []) {
  const log: { applied?: Parameters<CalendarSyncStore["apply"]>[0]; failed?: { code: string; retryAt: Date | null }; saved?: TokenSet } = {};
  const s: CalendarSyncStore = {
    credentials: async () => creds,
    saveTokens: async (_id, t) => { log.saved = t; },
    affectingCalendars: async () => affecting,
    apply: async (input) => { log.applied = input; },
    fail: async (_id, code, retryAt) => { log.failed = { code, retryAt }; },
  };
  return { s, log };
}

const now = () => new Date("2026-11-02T15:00:00Z");
const valid: StoredCredentials = { accessToken: "token", refreshToken: "refresh", expiresAt: new Date("2026-11-02T15:30:00Z") };

describe("calendar sync", () => {
  it("a new connection: the primary calendar's busy time, merged, inside the window", async () => {
    const { a, calls } = adapter();
    const { s, log } = store(valid);
    expect(await syncConnection("c1", { adapter: a, store: s, now })).toEqual({ ok: true, busyIntervals: 1, calendars: 2 });
    expect(calls).toEqual(["list:token", "freebusy:token:primary"]);
    expect(log.applied!.busy).toEqual([{ calendar: "primary", start: "2026-11-03T10:00:00.000Z", end: "2026-11-03T12:00:00.000Z" }]);
    expect(log.applied!.calendars.map((c) => c.id)).toEqual(["primary", "family"]);
  });
  it("only the calendars the coach chose, and only those that still exist", async () => {
    const { a, calls } = adapter();
    const { s } = store(valid, ["family", "deleted-one"]);
    await syncConnection("c1", { adapter: a, store: s, now });
    expect(calls).toContain("freebusy:token:family");
  });
  it("refreshes an expiring token first and keeps the stored refresh token when the provider does not rotate it", async () => {
    const { a, calls } = adapter();
    const { s, log } = store({ ...valid, expiresAt: new Date("2026-11-02T15:01:00Z") });
    await syncConnection("c1", { adapter: a, store: s, now });
    expect(calls[0]).toBe("refresh");
    expect(calls).toContain("list:fresh");
    expect(log.saved!.refreshToken).toBe("refresh");
  });
  it("an expired token with no refresh token: reconnect required, no retry", async () => {
    const { a } = adapter();
    const { s, log } = store({ ...valid, refreshToken: null, expiresAt: null });
    expect(await syncConnection("c1", { adapter: a, store: s, now })).toEqual({ ok: false, code: "token_expired", reconnect: true });
    expect(log.failed).toEqual({ code: "token_expired", retryAt: null });
    expect(log.applied).toBeUndefined();
  });
  it("revoked access is a reconnect; an outage is retried (provider's Retry-After when given)", async () => {
    const revoked = adapter({ listCalendars: async () => { throw new CalendarProviderError("token_revoked"); } });
    const r1 = store(valid);
    expect(await syncConnection("c1", { adapter: revoked.a, store: r1.s, now })).toMatchObject({ code: "token_revoked", reconnect: true });
    const limited = adapter({ freeBusy: async () => { throw new CalendarProviderError("rate_limited", 120); } });
    const r2 = store(valid);
    expect(await syncConnection("c1", { adapter: limited.a, store: r2.s, now })).toMatchObject({ code: "rate_limited", reconnect: false });
    expect(r2.log.failed!.retryAt!.toISOString()).toBe("2026-11-02T15:02:00.000Z");
  });
  it("an unexpected error is stored as unknown — never its message", async () => {
    const { a } = adapter({ listCalendars: async () => { throw new Error("HTTP 500 body with secrets"); } });
    const { s, log } = store(valid);
    expect(await syncConnection("c1", { adapter: a, store: s, now })).toMatchObject({ code: "unknown" });
    expect(JSON.stringify(log.failed)).not.toContain("secrets");
  });
  it("no credentials at all: treated as revoked", async () => {
    const { a } = adapter();
    const { s } = store(null);
    expect(await syncConnection("c1", { adapter: a, store: s, now })).toMatchObject({ code: "token_revoked", reconnect: true });
  });
  it("the next sync is a safety net: 6 h with push notifications, 30 min without", async () => {
    const { a } = adapter();
    const withPush = store(valid);
    await syncConnection("c1", { adapter: a, store: withPush.s, now, hasPushChannel: true });
    expect(withPush.log.applied!.nextSyncAt.toISOString()).toBe("2026-11-02T21:00:00.000Z");
  });
});
