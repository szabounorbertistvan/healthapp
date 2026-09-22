import { describe, expect, it } from "vitest";
import { previousWorkouts } from "@healthapp/shared";
import { toAnalyticsSets, type AnalyticsSetJoin } from "./exercise-analytics-map";

function join(over: Partial<AnalyticsSetJoin> & { session: AnalyticsSetJoin["session"] }): AnalyticsSetJoin {
  return {
    id: "set-1",
    set_index: 1,
    weight_kg: 110,
    reps: 8,
    rpe: null,
    rir: null,
    is_pr: null,
    exercise_id: "ex-bench",
    program_exercise_id: null,
    ...over,
  };
}

const completed = {
  id: "s-done",
  started_at: "2026-09-20T09:00:00Z",
  completed_at: "2026-09-20T10:00:00Z",
  day: { name: "Upper A" },
};

const open = {
  id: "s-open",
  started_at: "2026-09-22T09:00:00Z",
  completed_at: null,
  day: { name: "Upper A" },
};

describe("toAnalyticsSets", () => {
  it("carries a completed session's set through with the session's own timestamp", () => {
    expect(toAnalyticsSets([join({ session: completed })])).toEqual([
      {
        id: "set-1",
        session_id: "s-done",
        session_at: "2026-09-20T10:00:00Z",
        session_name: "Upper A",
        exercise_id: "ex-bench",
        program_exercise_id: null,
        set_index: 1,
        weight_kg: 110,
        reps: 8,
        rpe: null,
        rir: null,
        is_pr: false,
      },
    ]);
  });

  it("drops a set whose session was never finished", () => {
    expect(toAnalyticsSets([join({ session: open })])).toEqual([]);
  });

  it("drops a set whose session did not come back at all", () => {
    expect(toAnalyticsSets([join({ session: null })])).toEqual([]);
  });

  it("keeps the abandoned session out of 'previous' even when it is the newest", () => {
    // The exact regression this guards: today's half-finished workout must not
    // become the target shown above today's boxes.
    const rows = [
      join({ id: "today", session: open, weight_kg: 60, reps: 5 }),
      join({ id: "lasttime", session: completed, weight_kg: 110, reps: 8 }),
    ];
    const previous = previousWorkouts(toAnalyticsSets(rows));
    expect(previous.get("ex-bench")?.session_id).toBe("s-done");
    expect(previous.get("ex-bench")?.sets).toEqual([
      { set_index: 1, weight_kg: 110, reps: 8, rpe: null, rir: null, is_pr: false },
    ]);
  });

  it("treats a missing load or rep count as zero rather than null", () => {
    const [row] = toAnalyticsSets([join({ session: completed, weight_kg: null, reps: null })]);
    expect(row).toMatchObject({ weight_kg: 0, reps: 0 });
  });

  it("survives a session with no program day", () => {
    const [row] = toAnalyticsSets([join({ session: { ...completed, day: null } })]);
    expect(row?.session_name).toBeNull();
  });
});
