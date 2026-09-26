import { describe, expect, it } from "vitest";
import { toSessionSummary, type SessionSummaryJoin } from "./session-summary";

function row(over: Partial<SessionSummaryJoin> = {}): SessionSummaryJoin {
  return {
    id: "s1",
    program_day_id: "d1",
    started_at: "2026-09-12T08:00:00Z",
    completed_at: "2026-09-12T09:00:00Z",
    day: { name: "Lower B" },
    logged_sets: [
      { weight_kg: 72.5, reps: 5, rpe: null, rir: 2, exercise_id: "dl", is_pr: false },
      { weight_kg: 21.25, reps: 7, rpe: 8, rir: null, exercise_id: "curl", is_pr: true },
    ],
    ...over,
  };
}

describe("toSessionSummary", () => {
  it("keeps volume_kg rounded, as history and Today have always shown it", () => {
    // 362.5 + 148.75 = 511.25
    expect(toSessionSummary(row()).volume_kg).toBe(511);
  });

  it("carries the exact volume alongside, for totals that must not drift", () => {
    expect(toSessionSummary(row()).volume_exact_kg).toBe(511.25);
  });

  it("summing exact volumes is not summing rounded ones", () => {
    const sessions = [row({ id: "a" }), row({ id: "b" })].map(toSessionSummary);
    expect(sessions.reduce((s, x) => s + x.volume_exact_kg, 0)).toBe(1022.5);
    expect(sessions.reduce((s, x) => s + x.volume_kg, 0)).toBe(1022);
  });

  it("maps the rest unchanged: name, time, sets, PR flags", () => {
    const s = toSessionSummary(row());
    expect(s).toMatchObject({ id: "s1", day_id: "d1", day_name: "Lower B", at: "2026-09-12T09:00:00Z", sets: 2, prs: 1 });
  });

  it("falls back to the start time and a generic name, and survives no sets", () => {
    const s = toSessionSummary(row({ completed_at: null, day: null, logged_sets: null }));
    expect(s.at).toBe("2026-09-12T08:00:00Z");
    expect(s.day_name).toBe("Session");
    expect(s.volume_kg).toBe(0);
    expect(s.volume_exact_kg).toBe(0);
  });
});
