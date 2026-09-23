import { describe, expect, test } from "vitest";
import { exerciseSeries, exerciseSessions, exerciseSummary, repRecords, type ExerciseSetInput } from "./exercise-history";

const set = (session: string, at: string, index: number, weight: number | null, reps: number, is_pr = false): ExerciseSetInput => ({
  session_id: session, session_at: at, set_index: index, weight_kg: weight, reps, is_pr,
});

const ROWS: ExerciseSetInput[] = [
  set("a", "2026-09-01T10:00:00Z", 1, 60, 10),
  set("a", "2026-09-01T10:00:00Z", 2, 70, 5),
  set("b", "2026-09-08T10:00:00Z", 2, 80, 3, true),
  set("b", "2026-09-08T10:00:00Z", 1, 60, 12),
  set("c", "2026-09-15T10:00:00Z", 1, 80, 3),
  set("c", "2026-09-15T10:00:00Z", 2, 0, 0),
];

describe("exerciseSessions", () => {
  const sessions = exerciseSessions(ROWS);

  test("groups by session, newest first, sets in order, empty sets dropped", () => {
    expect(sessions.map((s) => s.session_id)).toEqual(["c", "b", "a"]);
    expect(sessions[1]!.sets.map((s) => s.set_index)).toEqual([1, 2]);
    expect(sessions[0]!.sets).toHaveLength(1);
  });

  test("computes each session's best 1RM, heaviest set and volume", () => {
    const a = sessions[2]!;
    expect(a.best_e1rm).toBe(81.7); // 70 × (1 + 5/30)
    expect(a.heaviest).toEqual({ weight_kg: 70, reps: 5 });
    expect(a.volume_kg).toBe(950);
    expect(a.max_reps).toBe(10);
  });

  test("keeps the PR flag on the set", () => {
    expect(sessions[1]!.sets.find((s) => s.weight_kg === 80)?.is_pr).toBe(true);
  });
});

describe("exerciseSummary", () => {
  test("lifetime bests, a tie keeping the first date", () => {
    const summary = exerciseSummary(exerciseSessions(ROWS));
    expect(summary.sessions).toBe(3);
    expect(summary.sets).toBe(5);
    expect(summary.heaviest).toEqual({ weight_kg: 80, reps: 3, at: "2026-09-08T10:00:00Z" });
    expect(summary.best_e1rm?.value).toBe(88); // 80 × (1 + 3/30) beats 60 × (1 + 12/30) = 84
    expect(summary.best_session_volume).toEqual({ value: 960, at: "2026-09-08T10:00:00Z" });
    expect(summary.max_reps?.value).toBe(12);
    expect(summary.bodyweight).toBe(false);
  });

  test("flags an exercise nobody ever loaded as bodyweight", () => {
    const summary = exerciseSummary(exerciseSessions([set("x", "2026-09-01T10:00:00Z", 1, null, 15)]));
    expect(summary.bodyweight).toBe(true);
    expect(summary.best_e1rm).toBeNull();
    expect(summary.max_reps?.value).toBe(15);
  });

  test("an empty history has no bests", () => {
    const summary = exerciseSummary([]);
    expect(summary).toMatchObject({ sessions: 0, best_e1rm: null, heaviest: null, bodyweight: false });
  });
});

describe("repRecords", () => {
  const records = repRecords(exerciseSessions(ROWS));

  test("is the heaviest load for at least N reps, so it never rises with N", () => {
    expect(records.find((r) => r.reps === 1)?.weight_kg).toBe(80);
    expect(records.find((r) => r.reps === 5)?.weight_kg).toBe(70);
    expect(records.find((r) => r.reps === 10)?.weight_kg).toBe(60);
    for (let i = 1; i < records.length; i++) expect(records[i]!.weight_kg).toBeLessThanOrEqual(records[i - 1]!.weight_kg);
  });

  test("dates a record by the first session that reached it", () => {
    expect(records.find((r) => r.reps === 3)?.at).toBe("2026-09-08T10:00:00Z");
  });

  test("stops at maxReps and ignores bodyweight sets", () => {
    expect(records.at(-1)?.reps).toBe(12);
    expect(repRecords(exerciseSessions([set("x", "2026-09-01T10:00:00Z", 1, 0, 20)]))).toEqual([]);
  });
});

describe("exerciseSeries", () => {
  test("is oldest first and leaves out sessions with nothing to plot", () => {
    const sessions = exerciseSessions([...ROWS, set("d", "2026-09-20T10:00:00Z", 1, null, 8)]);
    expect(exerciseSeries(sessions, "heaviest").map((p) => p.value)).toEqual([70, 80, 80]);
    expect(exerciseSeries(sessions, "reps").map((p) => p.value)).toEqual([10, 12, 3, 8]);
  });
});
