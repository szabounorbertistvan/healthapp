import { describe, expect, it } from "vitest";
import { analyzeProgression, exerciseStats, exerciseSessions, previousWorkouts } from "@healthapp/shared";
import { toAnalyticsSets, toProgressionSessions, type AnalyticsSetJoin } from "./exercise-analytics-map";

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

describe("warm-ups and the progression input", () => {
  it("marks a set logged against a warm-up prescription, and only then", () => {
    const [warm, work, bare] = toAnalyticsSets([
      join({ id: "w", session: completed, prescribed: { set_type: "warmup", target_reps: "10" } }),
      join({ id: "n", session: completed, prescribed: { set_type: "normal", target_reps: "8-10" } }),
      join({ id: "b", session: completed }),
    ]);
    expect(warm).toMatchObject({ warmup: true, target_reps: "10" });
    expect(work).toMatchObject({ warmup: false, target_reps: "8-10" });
    expect(bare).not.toHaveProperty("warmup"); // no prescription: a working set, shape unchanged
  });

  it("the history list shows the warm-up flag, but the existing totals still count every set", () => {
    const sets = toAnalyticsSets([
      join({ id: "w", set_index: 1, weight_kg: 60, reps: 10, session: completed, prescribed: { set_type: "warmup", target_reps: null } }),
      join({ id: "n", set_index: 2, weight_kg: 100, reps: 5, session: completed }),
    ]);
    const [session] = exerciseSessions(sets);
    expect(session!.sets[0]).toMatchObject({ warmup: true });
    expect(session!.sets[1]).not.toHaveProperty("warmup");
    // the page's totals are unchanged by this work: 60×10 + 100×5
    expect(exerciseStats([session!]).total_volume_kg).toBe(1100);
  });

  it("groups one exercise's sets into sessions on the person's own day, warm-ups flagged", () => {
    // 22:30 UTC on 2026-09-20 is already 21 September in Bucharest
    const late = { ...completed, id: "s-late", completed_at: "2026-09-20T22:30:00Z" };
    const sessions = toProgressionSessions(
      toAnalyticsSets([
        join({ id: "a", session: late, prescribed: { set_type: "warmup", target_reps: null } }),
        join({ id: "b", session: late }),
      ]),
      "Europe/Bucharest",
    );
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.day).toBe("2026-09-21");
    expect(sessions[0]!.sets.map((x) => x.warmup)).toEqual([true, false]);
  });

  it("an unfinished session never reaches the progression analysis", () => {
    const sets = toAnalyticsSets([join({ session: open, weight_kg: 500, reps: 5 })]);
    const a = analyzeProgression(toProgressionSessions(sets, "Europe/Bucharest"), "2026-09-25");
    expect(a.sessions_analyzed).toBe(0);
    expect(a.status).toBe("insufficient");
  });
});
