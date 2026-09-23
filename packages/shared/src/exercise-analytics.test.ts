import { describe, expect, it } from "vitest";
import {
  defaultRange,
  exerciseSessions,
  exerciseSnapshot,
  exerciseStats,
  metricSeries,
  ONE_RM_MAX_REPS,
  previousFor,
  previousSetFor,
  prefillFor,
  previousWorkouts,
  progressionVs,
  relevantOneRm,
  repRecords,
  setVolume,
  totalVolume,
  type AnalyticsSet,
} from "./exercise-analytics";
import { estimated1RM, estimated1RMExact } from "./prs";

const BENCH = "ex-bench";
const SQUAT = "ex-squat";

/** One logged set, with only the fields a case cares about spelled out. */
function set(over: Partial<AnalyticsSet> & Pick<AnalyticsSet, "session_id" | "session_at">): AnalyticsSet {
  return {
    id: `${over.session_id}-${over.set_index ?? 1}-${over.exercise_id ?? BENCH}`,
    session_name: "Upper A",
    exercise_id: BENCH,
    program_exercise_id: null,
    set_index: 1,
    weight_kg: 100,
    reps: 10,
    rpe: null,
    rir: null,
    is_pr: false,
    ...over,
  };
}

/** The example from the brief: 110x8, 105x9, 100x10 in one session. */
function benchSession(sessionId: string, at: string, exercise_id = BENCH): AnalyticsSet[] {
  return [
    set({ session_id: sessionId, session_at: at, exercise_id, set_index: 1, weight_kg: 110, reps: 8, rir: 2 }),
    set({ session_id: sessionId, session_at: at, exercise_id, set_index: 2, weight_kg: 105, reps: 9, rir: 1 }),
    set({ session_id: sessionId, session_at: at, exercise_id, set_index: 3, weight_kg: 100, reps: 10, rir: 1 }),
  ];
}

describe("setVolume / totalVolume", () => {
  it("is weight x reps", () => {
    expect(setVolume(110, 8)).toBe(880);
  });

  it("keeps decimal weights exact — 21.25 kg never becomes 21", () => {
    expect(setVolume(21.25, 8)).toBe(170);
    expect(setVolume(21.5, 2)).toBe(43);
  });

  it("sums multiple sets", () => {
    expect(totalVolume([
      { weight_kg: 110, reps: 8 },
      { weight_kg: 105, reps: 9 },
      { weight_kg: 100, reps: 10 },
    ])).toBe(2825);
  });

  it("counts an empty or bodyweight set as zero rather than NaN", () => {
    expect(totalVolume([])).toBe(0);
    expect(setVolume(0, 12)).toBe(0);
    expect(setVolume(60, 0)).toBe(0);
    expect(setVolume(Number.NaN, 5)).toBe(0);
  });
});

describe("relevantOneRm", () => {
  it("is Epley", () => {
    expect(relevantOneRm(100, 10)).toBeCloseTo(133.3333, 4);
    expect(relevantOneRm(110, 8)).toBeCloseTo(139.3333, 4);
  });

  it("keeps full precision — the display rounds, not the maths", () => {
    expect(relevantOneRm(100, 10)).not.toBe(133.3);
    expect(estimated1RM(100, 10)).toBe(133.3);
    expect(estimated1RMExact(100, 10)).toBeCloseTo(133.3333, 4);
  });

  it("takes a single rep at face value", () => {
    expect(relevantOneRm(140, 1)).toBe(140);
  });

  it("returns null for zero reps, zero load and nonsense", () => {
    expect(relevantOneRm(100, 0)).toBeNull();
    expect(relevantOneRm(0, 8)).toBeNull();
    expect(relevantOneRm(-50, 8)).toBeNull();
    expect(relevantOneRm(Number.NaN, 8)).toBeNull();
    expect(relevantOneRm(100, 8.5)).toBeNull();
  });

  it("stops estimating above the rep range where Epley still means something", () => {
    expect(relevantOneRm(60, ONE_RM_MAX_REPS)).not.toBeNull();
    expect(relevantOneRm(60, ONE_RM_MAX_REPS + 1)).toBeNull();
    expect(relevantOneRm(60, 30)).toBeNull();
  });

  it("handles decimal weights", () => {
    expect(relevantOneRm(62.5, 5)).toBeCloseTo(72.9167, 4);
  });
});

describe("previousWorkouts", () => {
  it("finds the latest completed session for the exercise", () => {
    const rows = [
      ...benchSession("s-old", "2026-09-17T10:00:00Z"),
      ...benchSession("s-new", "2026-09-20T10:00:00Z"),
    ];
    const previous = previousWorkouts(rows);
    expect(previous.get(BENCH)?.session_id).toBe("s-new");
    expect(previous.get(BENCH)?.sets).toHaveLength(3);
  });

  it("ignores an abandoned session — the caller passes only completed rows", () => {
    // The incomplete session is simply absent from the input, which is the
    // contract: getExerciseHistory filters on completed_at in SQL.
    const rows = benchSession("s-done", "2026-09-17T10:00:00Z");
    expect(previousWorkouts(rows).get(BENCH)?.session_id).toBe("s-done");
  });

  it("orders the sets by set_index whatever order the rows arrive in", () => {
    const [a, b, c] = benchSession("s1", "2026-09-20T10:00:00Z");
    const previous = previousWorkouts([c!, a!, b!]);
    expect(previous.get(BENCH)?.sets.map((s) => s.set_index)).toEqual([1, 2, 3]);
    expect(previous.get(BENCH)?.sets.map((s) => s.weight_kg)).toEqual([110, 105, 100]);
  });

  it("keeps the exercises apart", () => {
    const rows = [
      ...benchSession("s1", "2026-09-20T10:00:00Z"),
      set({ session_id: "s1", session_at: "2026-09-20T10:00:00Z", exercise_id: SQUAT, weight_kg: 140, reps: 5 }),
    ];
    const previous = previousWorkouts(rows);
    expect(previous.get(BENCH)?.sets).toHaveLength(3);
    expect(previous.get(SQUAT)?.sets).toEqual([
      { set_index: 1, weight_kg: 140, reps: 5, rpe: null, rir: null, is_pr: false },
    ]);
  });

  it("has no answer when there is no history", () => {
    const previous = previousWorkouts([]);
    expect(previous.get(BENCH)).toBeUndefined();
    expect(previousFor(previous, { exerciseId: BENCH })).toBeNull();
  });

  it("picks the later of two sessions on the same day", () => {
    const rows = [
      ...benchSession("morning", "2026-09-20T07:30:00Z"),
      set({ session_id: "evening", session_at: "2026-09-20T19:00:00Z", weight_kg: 115, reps: 6 }),
    ];
    const previous = previousWorkouts(rows);
    expect(previous.get(BENCH)?.session_id).toBe("evening");
    expect(previous.get(BENCH)?.sets[0]?.weight_kg).toBe(115);
  });

  it("breaks an exact timestamp tie deterministically", () => {
    const at = "2026-09-20T10:00:00Z";
    const a = previousWorkouts([
      set({ session_id: "aaa", session_at: at, weight_kg: 80 }),
      set({ session_id: "bbb", session_at: at, weight_kg: 90 }),
    ]);
    const b = previousWorkouts([
      set({ session_id: "bbb", session_at: at, weight_kg: 90 }),
      set({ session_id: "aaa", session_at: at, weight_kg: 80 }),
    ]);
    expect(a.get(BENCH)?.session_id).toBe(b.get(BENCH)?.session_id);
  });

  it("keeps a lift programmed twice in a day on separate keys", () => {
    const rows = [
      set({ session_id: "s1", session_at: "2026-09-20T10:00:00Z", program_exercise_id: "heavy", weight_kg: 120, reps: 3 }),
      set({ session_id: "s1", session_at: "2026-09-20T10:00:00Z", program_exercise_id: "backoff", weight_kg: 90, reps: 12 }),
    ];
    const previous = previousWorkouts(rows);
    expect(previousFor(previous, { programExerciseId: "heavy", exerciseId: BENCH })?.sets[0]?.weight_kg).toBe(120);
    expect(previousFor(previous, { programExerciseId: "backoff", exerciseId: BENCH })?.sets[0]?.weight_kg).toBe(90);
  });

  it("falls back to the exercise when the prescribed row has no history of its own", () => {
    const previous = previousWorkouts(benchSession("s1", "2026-09-20T10:00:00Z"));
    expect(previousFor(previous, { programExerciseId: "brand-new", exerciseId: BENCH })?.sets).toHaveLength(3);
  });
});

describe("previousSetFor", () => {
  const previous = previousWorkouts(benchSession("s1", "2026-09-20T10:00:00Z")).get(BENCH) ?? null;

  it("matches the set number, so set 2 opens on last time's set 2", () => {
    expect(previousSetFor(previous, 2)).toMatchObject({ weight_kg: 105, reps: 9 });
  });

  it("falls back to the last set once past what was done last time", () => {
    expect(previousSetFor(previous, 9)).toMatchObject({ weight_kg: 100, reps: 10 });
  });

  it("is null without history", () => {
    expect(previousSetFor(null, 1)).toBeNull();
  });
});

describe("exerciseSessions / exerciseStats", () => {
  const rows = [
    ...benchSession("s-old", "2026-09-17T10:00:00Z"),
    ...benchSession("s-new", "2026-09-20T10:00:00Z"),
  ];

  it("groups by session, newest first, with exact volume", () => {
    const sessions = exerciseSessions(rows);
    expect(sessions.map((s) => s.session_id)).toEqual(["s-new", "s-old"]);
    expect(sessions[0]?.volume_kg).toBe(2825);
    expect(sessions[0]?.top_weight_kg).toBe(110);
    expect(sessions[0]?.top_reps).toBe(10);
    expect(sessions[0]?.best_1rm).toBeCloseTo(139.3333, 4);
  });

  it("reports exact totals across sessions", () => {
    const stats = exerciseStats(exerciseSessions(rows));
    expect(stats.sessions).toBe(2);
    expect(stats.total_sets).toBe(6);
    expect(stats.total_volume_kg).toBe(5650);
    expect(stats.best_weight_kg).toBe(110);
    expect(stats.best_reps).toBe(10);
    expect(stats.best_reps_at_best_weight).toBe(8);
    expect(stats.best_volume_kg).toBe(2825);
    expect(stats.best_1rm).toBeCloseTo(139.3333, 4);
    expect(stats.last?.session_id).toBe("s-new");
  });

  it("is empty, not broken, with no data at all", () => {
    const stats = exerciseStats(exerciseSessions([]));
    expect(stats).toMatchObject({
      last: null, best_weight_kg: null, best_1rm: null, sessions: 0, total_sets: 0, total_volume_kg: 0,
    });
  });

  it("handles a single session", () => {
    const stats = exerciseStats(exerciseSessions(benchSession("only", "2026-09-20T10:00:00Z")));
    expect(stats.sessions).toBe(1);
    expect(stats.total_volume_kg).toBe(2825);
    expect(stats.last?.sets).toHaveLength(3);
  });

  it("reports no 1RM for bodyweight-only history but still counts the sets", () => {
    const stats = exerciseStats(exerciseSessions([
      set({ session_id: "bw", session_at: "2026-09-20T10:00:00Z", weight_kg: 0, reps: 15 }),
    ]));
    expect(stats.best_1rm).toBeNull();
    expect(stats.total_volume_kg).toBe(0);
    expect(stats.total_sets).toBe(1);
  });
});

describe("metricSeries / defaultRange", () => {
  const sessions = exerciseSessions([
    ...benchSession("s-jan", "2026-01-10T10:00:00Z"),
    ...benchSession("s-old", "2026-08-01T10:00:00Z"),
    ...benchSession("s-new", "2026-09-20T10:00:00Z"),
  ]);
  const today = "2026-09-22";

  it("returns oldest-first points inside the window", () => {
    const points = metricSeries(sessions, "volume", 90, today);
    expect(points.map((p) => p.day)).toEqual(["2026-08-01", "2026-09-20"]);
    expect(points[0]?.value).toBe(2825);
  });

  it("narrows to the requested range", () => {
    expect(metricSeries(sessions, "volume", 7, today).map((p) => p.day)).toEqual(["2026-09-20"]);
    expect(metricSeries(sessions, "volume", 365, today)).toHaveLength(3);
    expect(metricSeries(sessions, "volume", null, today)).toHaveLength(3);
  });

  it("charts weight and estimated 1RM from the same sessions", () => {
    expect(metricSeries(sessions, "weight", 90, today).map((p) => p.value)).toEqual([110, 110]);
    expect(metricSeries(sessions, "one_rm", 90, today)[0]?.value).toBeCloseTo(139.3333, 4);
  });

  it("drops sessions with nothing to plot rather than plotting a zero", () => {
    const bodyweight = exerciseSessions([
      set({ session_id: "bw", session_at: "2026-09-20T10:00:00Z", weight_kg: 0, reps: 15 }),
    ]);
    expect(metricSeries(bodyweight, "one_rm", null, today)).toEqual([]);
    expect(metricSeries(bodyweight, "volume", null, today)).toEqual([]);
  });

  it("returns nothing for empty data", () => {
    expect(metricSeries([], "volume", 90, today)).toEqual([]);
  });

  it("opens on 90 days when that window has a trend to show", () => {
    expect(defaultRange(sessions, today)).toBe(90);
  });

  it("widens the default when 90 days holds fewer than two sessions", () => {
    const sparse = exerciseSessions([
      ...benchSession("s-jan", "2026-01-10T10:00:00Z"),
      ...benchSession("s-feb", "2026-02-10T10:00:00Z"),
    ]);
    expect(defaultRange(sparse, today)).toBe(365);
  });

  it("stays on 90 days when there is nothing anywhere", () => {
    expect(defaultRange([], today)).toBe(90);
  });
});

describe("progressionVs", () => {
  it("reports added load", () => {
    expect(progressionVs({ weight_kg: 112.5, reps: 8 }, { weight_kg: 110, reps: 8 })).toMatchObject({
      kind: "weight_up", weight_delta_kg: 2.5,
    });
  });

  it("reports lost load without dressing it up", () => {
    expect(progressionVs({ weight_kg: 107.5, reps: 8 }, { weight_kg: 110, reps: 8 })?.kind).toBe("weight_down");
  });

  it("reports reps when the load matched", () => {
    expect(progressionVs({ weight_kg: 110, reps: 9 }, { weight_kg: 110, reps: 8 })).toMatchObject({
      kind: "reps_up", reps_delta: 1,
    });
    expect(progressionVs({ weight_kg: 110, reps: 7 }, { weight_kg: 110, reps: 8 })?.kind).toBe("reps_down");
  });

  it("says same when nothing moved", () => {
    expect(progressionVs({ weight_kg: 110, reps: 8 }, { weight_kg: 110, reps: 8 })?.kind).toBe("same");
  });

  it("ignores float noise from a pound round-trip", () => {
    expect(progressionVs({ weight_kg: 110.000001, reps: 8 }, { weight_kg: 110, reps: 8 })?.kind).toBe("same");
  });

  it("is null with nothing to compare against", () => {
    expect(progressionVs({ weight_kg: 110, reps: 8 }, null)).toBeNull();
  });
});

describe("exerciseSnapshot", () => {
  it("carries performance and a date, and nothing private", () => {
    const snapshot = exerciseSnapshot("Bench Press", { weight_kg: 110, reps: 8, is_pr: true }, "2026-09-20T18:12:00Z");
    expect(snapshot).toEqual({
      exercise: "Bench Press",
      weight_kg: 110,
      reps: 8,
      volume_kg: 880,
      estimated_1rm: 139.3,
      is_pr: true,
      date: "2026-09-20",
    });
    // The shape is the guarantee: nothing here can leak body weight, calories
    // or measurements into a post.
    expect(Object.keys(snapshot).sort()).toEqual(
      ["date", "estimated_1rm", "exercise", "is_pr", "reps", "volume_kg", "weight_kg"],
    );
  });

  it("omits the estimate when the set cannot produce one", () => {
    expect(exerciseSnapshot("Pull-up", { weight_kg: 0, reps: 12, is_pr: false }, "2026-09-20T18:12:00Z").estimated_1rm).toBeNull();
  });
});

describe("prefillFor", () => {
  const previous = previousWorkouts(benchSession("s1", "2026-09-20T10:00:00Z")).get(BENCH) ?? null;
  const base = { previous, todaysLastSet: null, targetWeightKg: 80, targetReps: "10" };

  it("opens on last time's matching set — the structure carries over", () => {
    expect(prefillFor({ ...base, setNumber: 1 })).toEqual({ weight_kg: 110, reps: 8 });
    expect(prefillFor({ ...base, setNumber: 2 })).toEqual({ weight_kg: 105, reps: 9 });
    expect(prefillFor({ ...base, setNumber: 3 })).toEqual({ weight_kg: 100, reps: 10 });
  });

  it("falls back to today's own last set past the end of last time's block", () => {
    expect(prefillFor({ ...base, setNumber: 4 })).toEqual({ weight_kg: 100, reps: 10 });
  });

  it("uses today's set when there is no history at all", () => {
    expect(prefillFor({
      ...base, previous: null, setNumber: 2, todaysLastSet: { weight_kg: 62.5, reps: 6 },
    })).toEqual({ weight_kg: 62.5, reps: 6 });
  });

  it("falls back to the prescription when nothing has been logged", () => {
    expect(prefillFor({ ...base, previous: null, setNumber: 1 })).toEqual({ weight_kg: 80, reps: 10 });
  });

  it("reads the low end of a rep range", () => {
    expect(prefillFor({ ...base, previous: null, setNumber: 1, targetReps: "8-10" }).reps).toBe(8);
  });

  it("leaves the boxes empty rather than guessing for a solo program with no target", () => {
    expect(prefillFor({
      previous: null, todaysLastSet: null, targetWeightKg: null, targetReps: "", setNumber: 1,
    })).toEqual({ weight_kg: null, reps: null });
  });

  it("never suggests a zero or negative load", () => {
    expect(prefillFor({ ...base, previous: null, setNumber: 1, targetWeightKg: 0 }).weight_kg).toBeNull();
  });
});

// ---------- rep records and bodyweight (from origin/main's exercise-history) ----------
// The fixture and expectations are the ones main's exercise-history.test.ts
// pinned; the functions now live here so the page has one domain module.

const REP_ROWS: AnalyticsSet[] = [
  set({ session_id: "a", session_at: "2026-09-01T10:00:00Z", set_index: 1, weight_kg: 60, reps: 10 }),
  set({ session_id: "a", session_at: "2026-09-01T10:00:00Z", set_index: 2, weight_kg: 70, reps: 5 }),
  set({ session_id: "b", session_at: "2026-09-08T10:00:00Z", set_index: 2, weight_kg: 80, reps: 3, is_pr: true }),
  set({ session_id: "b", session_at: "2026-09-08T10:00:00Z", set_index: 1, weight_kg: 60, reps: 12 }),
  set({ session_id: "c", session_at: "2026-09-15T10:00:00Z", set_index: 1, weight_kg: 80, reps: 3 }),
  set({ session_id: "c", session_at: "2026-09-15T10:00:00Z", set_index: 2, weight_kg: 0, reps: 0 }),
];

describe("repRecords", () => {
  const records = repRecords(exerciseSessions(REP_ROWS));

  it("is the heaviest load for at least N reps, so it never rises with N", () => {
    expect(records.find((r) => r.reps === 1)?.weight_kg).toBe(80);
    expect(records.find((r) => r.reps === 5)?.weight_kg).toBe(70);
    expect(records.find((r) => r.reps === 10)?.weight_kg).toBe(60);
    for (let i = 1; i < records.length; i++) expect(records[i]!.weight_kg).toBeLessThanOrEqual(records[i - 1]!.weight_kg);
  });

  it("dates a record by the first session that reached it", () => {
    expect(records.find((r) => r.reps === 3)?.at).toBe("2026-09-08T10:00:00Z");
  });

  it("stops at ONE_RM_MAX_REPS and ignores bodyweight and zero-rep sets", () => {
    expect(records.at(-1)?.reps).toBe(ONE_RM_MAX_REPS);
    expect(repRecords(exerciseSessions([set({ session_id: "x", session_at: "2026-09-01T10:00:00Z", weight_kg: 0, reps: 20 })]))).toEqual([]);
  });

  it("is empty for no history", () => {
    expect(repRecords([])).toEqual([]);
  });
});

describe("exerciseStats · bodyweight", () => {
  it("an exercise nobody ever loaded is bodyweight: reps lead, no 1RM", () => {
    const stats = exerciseStats(exerciseSessions([set({ session_id: "x", session_at: "2026-09-01T10:00:00Z", weight_kg: 0, reps: 15 })]));
    expect(stats.bodyweight).toBe(true);
    expect(stats.best_1rm).toBeNull();
    expect(stats.best_reps).toBe(15);
  });

  it("one loaded set is enough to make it a weighted exercise", () => {
    expect(exerciseStats(exerciseSessions(REP_ROWS)).bodyweight).toBe(false);
  });

  it("an empty history is not bodyweight", () => {
    expect(exerciseStats([]).bodyweight).toBe(false);
  });
});

describe("metricSeries · reps", () => {
  it("plots the most reps in a set per session — the bodyweight line", () => {
    const sessions = exerciseSessions([
      set({ session_id: "p1", session_at: "2026-09-10T10:00:00Z", weight_kg: 0, reps: 12 }),
      set({ session_id: "p1", session_at: "2026-09-10T10:00:00Z", set_index: 2, weight_kg: 0, reps: 15 }),
      set({ session_id: "p2", session_at: "2026-09-17T10:00:00Z", weight_kg: 0, reps: 18 }),
    ]);
    expect(metricSeries(sessions, "reps", null, "2026-09-20")).toEqual([
      { day: "2026-09-10", value: 15 },
      { day: "2026-09-17", value: 18 },
    ]);
  });
});
