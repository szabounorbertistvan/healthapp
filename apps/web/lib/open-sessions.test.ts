import { describe, expect, it } from "vitest";
import { openPastSessions, sessionEndAt, type OpenSessionJoin } from "./open-sessions";

const BUCHAREST = "Europe/Bucharest";

function row(over: Partial<OpenSessionJoin>): OpenSessionJoin {
  return { id: "s", program_day_id: "d", started_at: "2026-10-27T15:00:00Z", day: { name: "Legs" }, logged_sets: [{ count: 3 }], ...over };
}

describe("openPastSessions", () => {
  it("keeps sessions with sets from an earlier day, newest first", () => {
    const out = openPastSessions(
      [
        row({ id: "a", started_at: "2026-10-20T15:00:00Z", logged_sets: [{ count: 8 }] }),
        row({ id: "b", started_at: "2026-10-27T15:00:00Z", logged_sets: [{ count: 15 }], day: [{ name: "Push" }] }),
      ],
      "2026-10-31",
      BUCHAREST,
    );
    expect(out.map((s) => s.id)).toEqual(["b", "a"]);
    expect(out[0]).toMatchObject({ day: "2026-10-27", day_name: "Push", set_count: 15, day_id: "d" });
  });

  it("leaves out today's session and empty ones", () => {
    const out = openPastSessions(
      [
        row({ id: "today", started_at: "2026-10-31T08:00:00Z" }),
        row({ id: "empty", started_at: "2026-10-29T08:00:00Z", logged_sets: [{ count: 0 }] }),
        row({ id: "none", started_at: "2026-10-29T08:00:00Z", logged_sets: null }),
      ],
      "2026-10-31",
      BUCHAREST,
    );
    expect(out).toEqual([]);
  });

  it("dates a session on the person's calendar, not UTC's", () => {
    // 22:30 UTC on the 30th is 00:30 on the 31st in Bucharest: today, so still in progress
    expect(openPastSessions([row({ started_at: "2026-10-30T22:30:00Z" })], "2026-10-31", BUCHAREST)).toEqual([]);
  });

  it("an ad-hoc session has no day", () => {
    const [s] = openPastSessions([row({ program_day_id: null, day: null })], "2026-10-31", BUCHAREST);
    expect(s).toMatchObject({ day_id: null, day_name: null });
  });
});

describe("sessionEndAt", () => {
  const now = new Date("2026-10-31T10:00:00Z");
  it("is the last set's client time, even when it arrived later", () => {
    expect(sessionEndAt("2026-10-27T15:00:00Z", [
      { client_ts: "2026-10-27T15:10:00Z", received_at: "2026-10-27T15:10:01Z" },
      { client_ts: "2026-10-27T15:40:00Z", received_at: "2026-10-28T09:00:00Z" },
    ], now)).toBe("2026-10-27T15:40:00.000Z");
  });
  it("falls back to received_at, and never goes before the start or past now", () => {
    expect(sessionEndAt("2026-10-27T15:00:00Z", [{ client_ts: null, received_at: "2026-10-27T15:20:00Z" }], now))
      .toBe("2026-10-27T15:20:00.000Z");
    expect(sessionEndAt("2026-10-27T15:00:00Z", [{ client_ts: "2026-10-27T14:00:00Z", received_at: "2026-10-27T14:00:00Z" }], now))
      .toBe("2026-10-27T15:00:00.000Z");
    expect(sessionEndAt("2026-10-27T15:00:00Z", [{ client_ts: "2026-11-02T00:00:00Z", received_at: "2026-10-27T16:00:00Z" }], now))
      .toBe(now.toISOString());
  });
  it("has no end without sets", () => {
    expect(sessionEndAt("2026-10-27T15:00:00Z", [], now)).toBeNull();
  });
});
