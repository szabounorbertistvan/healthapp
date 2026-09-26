import { describe, expect, it } from "vitest";
import {
  bodyProgress,
  MIN_INSIGHT_PCT,
  periodBuckets,
  periodChange,
  progressInsights,
  progressWindows,
  strengthHighlights,
  topExercises,
  trainingProgress,
  trainingStats,
  windowDays,
  type ProgressMeasurement,
  type ProgressSession,
} from "./progress";

const TODAY = "2026-09-26";

function session(day: string, over: Partial<ProgressSession> = {}): ProgressSession {
  return { id: `s-${day}-${over.id ?? ""}`, day, load: 50, volume_kg: 1000, sets: 10, prs: 0, lifts: [], ...over };
}

function weigh(day: string, weight_kg: number | null, circumferences: Record<string, number> = {}): ProgressMeasurement {
  return { day, weight_kg, circumferences };
}

// ---------- windows ----------

describe("progressWindows", () => {
  it("a 7-day range is today and the six days before, compared with the seven before those", () => {
    const w = progressWindows(TODAY, 7, "2026-01-01");
    expect(w.current).toEqual({ start: "2026-09-20", end: "2026-09-26" });
    expect(w.previous).toEqual({ start: "2026-09-13", end: "2026-09-19" });
  });

  it("30 days crosses a month boundary correctly", () => {
    const w = progressWindows(TODAY, 30, "2020-01-01");
    expect(w.current).toEqual({ start: "2026-08-28", end: "2026-09-26" });
    expect(w.previous).toEqual({ start: "2026-07-29", end: "2026-08-27" });
    expect(windowDays(w.current)).toBe(30);
    expect(windowDays(w.previous!)).toBe(30);
  });

  it("has no previous period when all of it lies before the first recorded day", () => {
    const w = progressWindows(TODAY, 30, "2026-09-01");
    expect(w.previous).toBeNull();
  });

  it("keeps a previous period that the history only partly covers", () => {
    const w = progressWindows(TODAY, 30, "2026-08-10");
    expect(w.previous).toEqual({ start: "2026-07-29", end: "2026-08-27" });
  });

  it("all time starts at the first recorded day and never has a previous period", () => {
    const w = progressWindows(TODAY, null, "2025-03-04");
    expect(w.current).toEqual({ start: "2025-03-04", end: TODAY });
    expect(w.previous).toBeNull();
  });

  it("all time with no data at all is just today", () => {
    const w = progressWindows(TODAY, null, null);
    expect(w.current).toEqual({ start: TODAY, end: TODAY });
    expect(w.previous).toBeNull();
  });

  it("a range with no data at all has no previous period either", () => {
    expect(progressWindows(TODAY, 7, null).previous).toBeNull();
  });
});

// ---------- change ----------

describe("periodChange", () => {
  it("is exact: no rounding of the delta or the percentage", () => {
    const c = periodChange(99.8, 101.45)!;
    expect(c.current).toBe(99.8);
    expect(c.previous).toBe(101.45);
    expect(c.delta).toBe(99.8 - 101.45);
    expect(c.pct).toBe(((99.8 - 101.45) / 101.45) * 100);
  });

  it("reports the percentage from a positive previous value", () => {
    expect(periodChange(47_200, 42_500)!.pct).toBeCloseTo(11.0588, 3);
  });

  it("has no percentage when the previous value is zero", () => {
    const c = periodChange(5, 0)!;
    expect(c.delta).toBe(5);
    expect(c.pct).toBeNull();
  });

  it("is null when either side is missing — no comparison is invented", () => {
    expect(periodChange(null, 3)).toBeNull();
    expect(periodChange(3, null)).toBeNull();
    expect(periodChange(undefined, undefined)).toBeNull();
  });

  it("is null for non-finite input", () => {
    expect(periodChange(Number.NaN, 3)).toBeNull();
    expect(periodChange(3, Number.POSITIVE_INFINITY)).toBeNull();
  });
});

// ---------- training ----------

describe("trainingStats", () => {
  const window = { start: "2026-09-20", end: "2026-09-26" };

  it("empty input is all zeros and no average", () => {
    const s = trainingStats([], window);
    expect(s).toEqual({
      workouts: 0, active_days: 0, volume_kg: 0, sets: 0, prs: 0,
      total_load: 0, avg_load: null, workouts_per_week: 0,
    });
  });

  it("counts only sessions inside the window, inclusive at both ends", () => {
    const s = trainingStats(
      [session("2026-09-19"), session("2026-09-20"), session("2026-09-26"), session("2026-09-27")],
      window,
    );
    expect(s.workouts).toBe(2);
  });

  it("two workouts on one day are two workouts but one active day", () => {
    const s = trainingStats([session("2026-09-21", { id: "a" }), session("2026-09-21", { id: "b" })], window);
    expect(s.workouts).toBe(2);
    expect(s.active_days).toBe(1);
  });

  it("sums volume exactly, keeping decimals", () => {
    const s = trainingStats(
      [session("2026-09-21", { volume_kg: 170.5 }), session("2026-09-22", { volume_kg: 21.25 })],
      window,
    );
    expect(s.volume_kg).toBe(191.75);
  });

  it("totals and averages the per-session load", () => {
    const s = trainingStats([session("2026-09-21", { load: 40 }), session("2026-09-22", { load: 61 })], window);
    expect(s.total_load).toBe(101);
    expect(s.avg_load).toBe(50.5);
  });

  it("workouts per week scales by the window length", () => {
    const month = { start: "2026-08-28", end: "2026-09-26" }; // 30 days
    const sessions = Array.from({ length: 12 }, (_, i) => session(`2026-09-${String(i + 1).padStart(2, "0")}`));
    expect(trainingStats(sessions, month).workouts_per_week).toBe(12 / (30 / 7));
  });

  it("sums sets and PRs", () => {
    const s = trainingStats([session("2026-09-21", { sets: 12, prs: 2 }), session("2026-09-22", { sets: 8, prs: 1 })], window);
    expect(s.sets).toBe(20);
    expect(s.prs).toBe(3);
  });
});

describe("trainingProgress", () => {
  it("compares with the previous window when one exists", () => {
    const windows = progressWindows(TODAY, 7, "2026-01-01");
    const p = trainingProgress(
      [
        session("2026-09-15", { volume_kg: 42_500, load: 132 }),
        session("2026-09-22", { volume_kg: 47_200, load: 148 }),
      ],
      windows,
    );
    expect(p.previous?.volume_kg).toBe(42_500);
    expect(p.changes?.volume_kg?.delta).toBe(4_700);
    expect(p.changes?.total_load?.current).toBe(148);
    expect(p.changes?.total_load?.previous).toBe(132);
  });

  it("has no previous stats and no changes for all time", () => {
    const p = trainingProgress([session("2026-09-22")], progressWindows(TODAY, null, "2026-09-22"));
    expect(p.previous).toBeNull();
    expect(p.changes).toBeNull();
  });

  it("average load compares only when both periods trained", () => {
    const windows = progressWindows(TODAY, 7, "2026-01-01");
    const p = trainingProgress([session("2026-09-22", { load: 70 })], windows);
    expect(p.changes?.avg_load).toBeNull();
    expect(p.changes?.workouts?.previous).toBe(0);
  });
});

describe("periodBuckets", () => {
  it("uses weekly buckets for short windows and keeps empty weeks", () => {
    const window = { start: "2026-08-28", end: "2026-09-26" };
    const buckets = periodBuckets([session("2026-09-01", { volume_kg: 500, load: 30 })], window);
    expect(buckets.unit).toBe("week");
    // Mondays covering 28 Aug (Fri) through 26 Sep (Sat)
    expect(buckets.items.map((b) => b.start)).toEqual(["2026-08-24", "2026-08-31", "2026-09-07", "2026-09-14", "2026-09-21"]);
    expect(buckets.items[1]).toEqual({ start: "2026-08-31", workouts: 1, volume_kg: 500, load: 30 });
    expect(buckets.items[0]!.workouts).toBe(0);
  });

  it("uses monthly buckets for long windows", () => {
    const window = { start: "2025-09-27", end: "2026-09-26" };
    const buckets = periodBuckets([session("2026-02-14", { volume_kg: 100 }), session("2026-02-20", { volume_kg: 50.5 })], window);
    expect(buckets.unit).toBe("month");
    expect(buckets.items[0]!.start).toBe("2025-09-01");
    expect(buckets.items.at(-1)!.start).toBe("2026-09-01");
    expect(buckets.items).toHaveLength(13);
    const feb = buckets.items.find((b) => b.start === "2026-02-01")!;
    expect(feb.volume_kg).toBe(150.5);
    expect(feb.workouts).toBe(2);
  });

  it("drops sessions outside the window", () => {
    const window = { start: "2026-09-20", end: "2026-09-26" };
    const buckets = periodBuckets([session("2026-09-01")], window);
    expect(buckets.items.every((b) => b.workouts === 0)).toBe(true);
  });
});

// ---------- strength ----------

const bench = "ex-bench";
const squat = "ex-squat";

describe("topExercises", () => {
  it("ranks by the number of sessions in the window, counting a session once", () => {
    const window = { start: "2026-09-20", end: "2026-09-26" };
    const top = topExercises(
      [
        session("2026-09-21", { lifts: [{ exercise_id: bench, weight_kg: 80, reps: 5 }, { exercise_id: bench, weight_kg: 80, reps: 5 }] }),
        session("2026-09-23", { lifts: [{ exercise_id: squat, weight_kg: 100, reps: 5 }, { exercise_id: bench, weight_kg: 82.5, reps: 5 }] }),
        session("2026-09-25", { lifts: [{ exercise_id: squat, weight_kg: 100, reps: 5 }] }),
        session("2026-09-10", { lifts: [{ exercise_id: squat, weight_kg: 100, reps: 5 }] }),
      ],
      window,
    );
    expect(top).toEqual([
      { exercise_id: bench, sessions: 2 },
      { exercise_id: squat, sessions: 2 },
    ]);
  });

  it("is empty with no sessions", () => {
    expect(topExercises([], { start: TODAY, end: TODAY })).toEqual([]);
  });
});

describe("strengthHighlights", () => {
  it("compares the best estimated 1RM of each lift between the two periods", () => {
    const windows = progressWindows(TODAY, 7, "2026-01-01");
    const h = strengthHighlights(
      [
        session("2026-09-15", { lifts: [{ exercise_id: bench, weight_kg: 100, reps: 1 }] }),
        session("2026-09-22", { lifts: [{ exercise_id: bench, weight_kg: 100, reps: 3 }] }),
      ],
      windows,
    );
    expect(h).toHaveLength(1);
    expect(h[0]!.exercise_id).toBe(bench);
    expect(h[0]!.change.previous).toBe(100);
    expect(h[0]!.change.current).toBe(100 * (1 + 3 / 30));
  });

  it("leaves out a lift not performed in both periods", () => {
    const windows = progressWindows(TODAY, 7, "2026-01-01");
    const h = strengthHighlights([session("2026-09-22", { lifts: [{ exercise_id: bench, weight_kg: 100, reps: 3 }] })], windows);
    expect(h).toEqual([]);
  });

  it("ignores sets with no estimate (bodyweight, very high reps)", () => {
    const windows = progressWindows(TODAY, 7, "2026-01-01");
    const h = strengthHighlights(
      [
        session("2026-09-15", { lifts: [{ exercise_id: bench, weight_kg: 0, reps: 10 }] }),
        session("2026-09-22", { lifts: [{ exercise_id: bench, weight_kg: 60, reps: 20 }] }),
      ],
      windows,
    );
    expect(h).toEqual([]);
  });

  it("is empty for all time", () => {
    const h = strengthHighlights([session("2026-09-22", { lifts: [{ exercise_id: bench, weight_kg: 100, reps: 3 }] })], progressWindows(TODAY, null, "2026-09-22"));
    expect(h).toEqual([]);
  });
});

// ---------- body ----------

describe("bodyProgress", () => {
  const windows = progressWindows(TODAY, 30, "2026-01-01");

  it("the series is every weigh-in in the window, oldest first, values untouched", () => {
    const b = bodyProgress(
      [weigh("2026-07-01", 103), weigh("2026-09-01", 101.45), weigh("2026-09-20", 99.8), weigh("2026-09-10", null)],
      windows,
    );
    expect(b.weight.series).toEqual([
      { day: "2026-09-01", value: 101.45 },
      { day: "2026-09-20", value: 99.8 },
    ]);
    expect(b.weight.latest).toEqual({ day: "2026-09-20", value: 99.8 });
  });

  it("compares the latest weigh-in of each period", () => {
    const b = bodyProgress([weigh("2026-08-01", 101.4), weigh("2026-08-20", 101), weigh("2026-09-20", 99.8)], windows);
    expect(b.weight.change?.previous).toBe(101);
    expect(b.weight.change?.current).toBe(99.8);
  });

  it("makes no comparison when the previous period has no weigh-in", () => {
    const b = bodyProgress([weigh("2026-06-01", 105), weigh("2026-09-20", 99.8)], windows);
    expect(b.weight.change).toBeNull();
  });

  it("reports each circumference that was ever logged, in a stable order", () => {
    const b = bodyProgress(
      [
        weigh("2026-08-20", 101, { waist: 92, chest: 110 }),
        weigh("2026-09-20", 99.8, { waist: 90.5 }),
      ],
      windows,
    );
    expect(Object.keys(b.circumferences)).toEqual(["chest", "waist"]);
    expect(b.circumferences.waist!.change?.delta).toBe(90.5 - 92);
    expect(b.circumferences.chest!.series).toEqual([]);
    expect(b.circumferences.chest!.change).toBeNull();
  });

  it("ignores non-numeric circumference values", () => {
    const b = bodyProgress([weigh("2026-09-20", null, { waist: "x" as unknown as number })], windows);
    expect(b.circumferences).toEqual({});
  });

  it("is empty with no measurements", () => {
    const b = bodyProgress([], windows);
    expect(b.weight).toEqual({ series: [], latest: null, change: null });
    expect(b.circumferences).toEqual({});
  });
});

// ---------- insights ----------

describe("progressInsights", () => {
  const windows = progressWindows(TODAY, 7, "2026-01-01");

  function build(sessions: ProgressSession[], measurements: ProgressMeasurement[] = []) {
    return progressInsights({
      training: trainingProgress(sessions, windows),
      strength: strengthHighlights(sessions, windows),
      body: bodyProgress(measurements, windows),
    });
  }

  it("says nothing when there is no data", () => {
    expect(build([])).toEqual([]);
  });

  it("says nothing comparative for all time", () => {
    const all = progressWindows(TODAY, null, "2026-09-22");
    const sessions = [session("2026-09-22", { prs: 0 })];
    expect(
      progressInsights({
        training: trainingProgress(sessions, all),
        strength: strengthHighlights(sessions, all),
        body: bodyProgress([], all),
      }),
    ).toEqual([]);
  });

  it("reports the 1RM change of a lift", () => {
    const i = build([
      session("2026-09-15", { lifts: [{ exercise_id: bench, weight_kg: 100, reps: 1 }] }),
      session("2026-09-22", { lifts: [{ exercise_id: bench, weight_kg: 105, reps: 1 }] }),
    ]);
    expect(i).toContainEqual({ key: "one_rm_change", exercise_id: bench, pct: 5, current: 105, previous: 100 });
  });

  it("reports the volume change only when the previous period had volume", () => {
    const up = build([session("2026-09-15", { volume_kg: 1000 }), session("2026-09-22", { volume_kg: 1200 })]);
    expect(up).toContainEqual({ key: "volume_change", pct: 20 });
    const fromNothing = build([session("2026-09-22", { volume_kg: 1200 })]);
    expect(fromNothing.some((x) => x.key === "volume_change")).toBe(false);
  });

  it("says nothing about volume or load when the current period has no training", () => {
    const i = build([session("2026-09-15", { volume_kg: 4920, load: 57 })]);
    expect(i.some((x) => x.key === "volume_change")).toBe(false);
    expect(i.some((x) => x.key === "load_change")).toBe(false);
    // …but the day count is a plain fact on both sides.
    expect(i).toContainEqual({ key: "active_days", current: 0, previous: 1 });
  });

  it("stays quiet about changes smaller than the threshold", () => {
    const i = build([session("2026-09-15", { volume_kg: 1000, load: 50 }), session("2026-09-22", { volume_kg: 1000 + (MIN_INSIGHT_PCT / 100) * 1000 - 1, load: 50 })]);
    expect(i.some((x) => x.key === "volume_change")).toBe(false);
    expect(i.some((x) => x.key === "load_change")).toBe(false);
  });

  it("reports active days against the previous period", () => {
    const i = build([session("2026-09-14"), session("2026-09-21"), session("2026-09-22")]);
    expect(i).toContainEqual({ key: "active_days", current: 2, previous: 1 });
  });

  it("reports body weight change in kg", () => {
    const i = build([], [weigh("2026-09-15", 101.4), weigh("2026-09-22", 99.8)]);
    expect(i).toHaveLength(1);
    expect(i[0]!.key).toBe("weight_change");
    expect((i[0] as { delta_kg: number }).delta_kg).toBe(99.8 - 101.4);
  });

  it("reports PRs set in the period", () => {
    const i = build([session("2026-09-22", { prs: 3 })]);
    expect(i).toContainEqual({ key: "prs", count: 3 });
  });

  it("is deterministic: the same input yields the same list", () => {
    const sessions = [
      session("2026-09-15", { volume_kg: 1000, load: 40, lifts: [{ exercise_id: squat, weight_kg: 100, reps: 5 }] }),
      session("2026-09-22", { volume_kg: 1500, load: 60, prs: 1, lifts: [{ exercise_id: squat, weight_kg: 110, reps: 5 }] }),
    ];
    expect(build(sessions)).toEqual(build([...sessions].reverse()));
  });
});
