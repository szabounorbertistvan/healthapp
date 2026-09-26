import { describe, expect, it } from "vitest";
import { toProgressSessions, type ProgressSessionJoin } from "./progress-map";
import { loadOf } from "./training-load";

function row(over: Partial<ProgressSessionJoin> = {}): ProgressSessionJoin {
  return {
    id: "s1",
    started_at: "2026-09-21T08:00:00Z",
    completed_at: "2026-09-21T09:00:00Z",
    logged_sets: [
      { weight_kg: 21.25, reps: 8, rpe: 8, rir: null, exercise_id: "bench", is_pr: true },
      { weight_kg: 100, reps: 5, rpe: null, rir: 2, exercise_id: "squat", is_pr: false },
    ],
    ...over,
  };
}

describe("toProgressSessions", () => {
  it("drops a session that was never completed", () => {
    expect(toProgressSessions([row({ completed_at: null })], "Europe/Bucharest")).toEqual([]);
  });

  it("sums volume exactly and counts PR sets", () => {
    const [s] = toProgressSessions([row()], "Europe/Bucharest");
    expect(s!.volume_kg).toBe(21.25 * 8 + 500);
    expect(s!.sets).toBe(2);
    expect(s!.prs).toBe(1);
  });

  it("scores the load with the same loadOf() every other surface uses", () => {
    const r = row();
    const [s] = toProgressSessions([r], "Europe/Bucharest");
    const expected = loadOf(
      r.logged_sets!.map((x) => ({ weight_kg: x.weight_kg, reps: x.reps, rpe: x.rpe, rir: x.rir, exercise: x.exercise_id })),
      r.started_at,
      r.completed_at,
    ).score;
    expect(s!.load).toBe(expected);
  });

  it("puts the session on the local day it started in the person's time zone", () => {
    const late = row({ started_at: "2026-09-21T22:30:00Z", completed_at: "2026-09-21T23:30:00Z" });
    expect(toProgressSessions([late], "Europe/Bucharest")[0]!.day).toBe("2026-09-22");
    expect(toProgressSessions([late], "America/New_York")[0]!.day).toBe("2026-09-21");
  });

  it("keeps lifts with an exercise and treats missing numbers as zero", () => {
    const [s] = toProgressSessions(
      [row({ logged_sets: [{ weight_kg: null, reps: 12, rpe: null, rir: null, exercise_id: "pullup", is_pr: null }, { weight_kg: 50, reps: 5, rpe: null, rir: null, exercise_id: null, is_pr: false }] })],
      "UTC",
    );
    expect(s!.lifts).toEqual([{ exercise_id: "pullup", weight_kg: 0, reps: 12 }]);
    expect(s!.volume_kg).toBe(250);
  });

  it("handles a session with no sets", () => {
    const [s] = toProgressSessions([row({ logged_sets: null })], "UTC");
    expect(s).toMatchObject({ volume_kg: 0, sets: 0, prs: 0, load: 0, lifts: [] });
  });
});
