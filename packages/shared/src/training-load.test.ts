import { describe, expect, test } from "vitest";
import {
  dailyLoad,
  effectiveRpe,
  loadTrend,
  sessionDurationMin,
  sumLoad,
  trainingLoad,
  trainingLoadCategory,
  type LoadSet,
} from "./training-load";

/** n identical sets. */
function sets(n: number, weight_kg: number, reps: number, rpe: number | null = null): LoadSet[] {
  return Array.from({ length: n }, () => ({ weight_kg, reps, rpe }));
}

describe("trainingLoad", () => {
  test("a very light session scores under 30", () => {
    const r = trainingLoad({ sets: sets(3, 20, 8, 5), duration_min: 15, exercise_count: 1 });
    expect(r.score).toBeLessThan(30);
    expect(r.category).toBe("very_light");
  });

  test("a light session lands in 30..49", () => {
    const r = trainingLoad({ sets: sets(9, 40, 10, 6.5), duration_min: 35, exercise_count: 3 });
    expect(r.score).toBeGreaterThanOrEqual(30);
    expect(r.score).toBeLessThan(50);
    expect(r.category).toBe("light");
  });

  test("a moderate session lands in 50..69", () => {
    const r = trainingLoad({ sets: sets(15, 50, 8, 7.5), duration_min: 60, exercise_count: 5 });
    expect(r.score).toBeGreaterThanOrEqual(50);
    expect(r.score).toBeLessThan(70);
    expect(r.category).toBe("moderate");
  });

  test("a hard session lands in 70..84", () => {
    const r = trainingLoad({ sets: sets(24, 73, 8, 8.5), duration_min: 80, exercise_count: 7 });
    expect(r.score).toBeGreaterThanOrEqual(70);
    expect(r.score).toBeLessThan(85);
    expect(r.category).toBe("hard");
  });

  test("a very hard session scores 85 or more", () => {
    const r = trainingLoad({ sets: sets(35, 90, 8, 9.5), duration_min: 110, exercise_count: 9 });
    expect(r.score).toBeGreaterThanOrEqual(85);
    expect(r.category).toBe("very_hard");
  });

  test("heavy-and-short differs from light-and-long at similar tonnage", () => {
    // 5×3 @150 kg near-maximal vs 15×10 @15 kg easy — 2250 kg both.
    const heavy = trainingLoad({ sets: sets(5, 150, 3, 9.5), exercise_count: 1 });
    const pump = trainingLoad({ sets: sets(15, 15, 10, 6), exercise_count: 3 });
    expect(heavy.volume_kg).toBe(pump.volume_kg);
    expect(heavy.score).not.toBe(pump.score);
    expect(heavy.intensity).toBe(9.5);
    expect(pump.intensity).toBe(6);
  });

  test("a session without duration still scores, from the other signals", () => {
    const withDuration = trainingLoad({ sets: sets(15, 50, 8, 7.5), duration_min: 60, exercise_count: 5 });
    const without = trainingLoad({ sets: sets(15, 50, 8, 7.5), duration_min: null, exercise_count: 5 });
    expect(without.duration_min).toBeNull();
    expect(without.score).toBeGreaterThan(0);
    // Same signals otherwise, so the two stay in the same neighbourhood.
    expect(Math.abs(without.score - withDuration.score)).toBeLessThan(10);
  });

  test("incomplete data: no RPE, no RIR, no duration, no exercise count", () => {
    const r = trainingLoad({ sets: sets(12, 60, 8) });
    expect(r.intensity).toBeNull();
    expect(r.duration_min).toBeNull();
    expect(r.exercises).toBe(0);
    expect(r.score).toBeGreaterThan(0);
    expect(r.score).toBeLessThanOrEqual(100);
  });

  test("RIR stands in for RPE when that is all the program logged", () => {
    const rir = trainingLoad({ sets: [{ weight_kg: 60, reps: 8, rir: 2 }] });
    expect(rir.intensity).toBe(8);
    expect(effectiveRpe({ rpe: null, rir: 0 })).toBe(10);
    expect(effectiveRpe({ rpe: 7, rir: 0 })).toBe(7); // slider wins when both exist
    expect(effectiveRpe({})).toBeNull();
  });

  test("zero volume (bodyweight only) still counts the sets", () => {
    const r = trainingLoad({ sets: sets(12, 0, 15, 8), duration_min: 40, exercise_count: 4 });
    expect(r.volume_kg).toBe(0);
    expect(r.sets).toBe(12);
    expect(r.score).toBeGreaterThan(0);
  });

  test("no sets at all is 0 / very_light", () => {
    const r = trainingLoad({ sets: [], duration_min: 90, exercise_count: 6 });
    expect(r.score).toBe(0);
    expect(r.category).toBe("very_light");
    expect(r.volume_kg).toBe(0);
  });

  test("sets with zero reps and negative weights are ignored, not counted", () => {
    const r = trainingLoad({ sets: [{ weight_kg: -50, reps: 5 }, { weight_kg: 80, reps: 0 }] });
    expect(r.sets).toBe(1);
    expect(r.volume_kg).toBe(0);
  });

  test("never leaves 0..100, even for absurd input", () => {
    const huge = trainingLoad({
      sets: sets(500, 300, 20, 10),
      duration_min: 360,
      exercise_count: 40,
    });
    expect(huge.score).toBeLessThanOrEqual(100);
    expect(huge.score).toBeGreaterThanOrEqual(0);
    expect(huge.category).toBe("very_hard");

    const tiny = trainingLoad({ sets: [{ weight_kg: 0, reps: 1, rpe: 1 }], duration_min: 1 });
    expect(tiny.score).toBeGreaterThanOrEqual(0);
    expect(tiny.score).toBeLessThan(30);
  });

  test("implausible durations (under a minute, over six hours) are treated as not recorded", () => {
    expect(trainingLoad({ sets: sets(5, 50, 5), duration_min: 0 }).duration_min).toBeNull();
    expect(trainingLoad({ sets: sets(5, 50, 5), duration_min: 900 }).duration_min).toBeNull();
    expect(trainingLoad({ sets: sets(5, 50, 5), duration_min: 45 }).duration_min).toBe(45);
  });

  test("score grows with each signal", () => {
    const base = trainingLoad({ sets: sets(10, 50, 8, 7), duration_min: 45, exercise_count: 4 });
    expect(trainingLoad({ sets: sets(10, 80, 8, 7), duration_min: 45, exercise_count: 4 }).score).toBeGreaterThan(base.score);
    expect(trainingLoad({ sets: sets(16, 50, 8, 7), duration_min: 45, exercise_count: 4 }).score).toBeGreaterThan(base.score);
    expect(trainingLoad({ sets: sets(10, 50, 8, 7), duration_min: 75, exercise_count: 4 }).score).toBeGreaterThan(base.score);
    expect(trainingLoad({ sets: sets(10, 50, 8, 9), duration_min: 45, exercise_count: 4 }).score).toBeGreaterThan(base.score);
    expect(trainingLoad({ sets: sets(10, 50, 8, 7), duration_min: 45, exercise_count: 7 }).score).toBeGreaterThan(base.score);
  });
});

describe("trainingLoadCategory", () => {
  test("uses the documented bands, inclusive at the lower edge", () => {
    expect(trainingLoadCategory(0)).toBe("very_light");
    expect(trainingLoadCategory(29)).toBe("very_light");
    expect(trainingLoadCategory(30)).toBe("light");
    expect(trainingLoadCategory(49)).toBe("light");
    expect(trainingLoadCategory(50)).toBe("moderate");
    expect(trainingLoadCategory(69)).toBe("moderate");
    expect(trainingLoadCategory(70)).toBe("hard");
    expect(trainingLoadCategory(84)).toBe("hard");
    expect(trainingLoadCategory(85)).toBe("very_hard");
    expect(trainingLoadCategory(100)).toBe("very_hard");
  });
});

describe("sessionDurationMin", () => {
  test("minutes between start and completion", () => {
    expect(sessionDurationMin("2026-09-10T10:00:00Z", "2026-09-10T11:12:00Z")).toBe(72);
  });
  test("null when unrecorded, identical, or absurd", () => {
    expect(sessionDurationMin("2026-09-10T10:00:00Z", null)).toBeNull();
    expect(sessionDurationMin("2026-09-10T10:00:00Z", "2026-09-10T10:00:00Z")).toBeNull();
    expect(sessionDurationMin("2026-09-10T10:00:00Z", "2026-09-12T10:00:00Z")).toBeNull();
    expect(sessionDurationMin("garbage", "2026-09-10T10:00:00Z")).toBeNull();
  });
});

describe("loadTrend", () => {
  test("percentage change with direction", () => {
    expect(loadTrend(318, 287)).toEqual({ current: 318, previous: 287, delta_pct: 10.8, direction: "increased" });
    expect(loadTrend(200, 287).direction).toBe("decreased");
  });
  test("small moves are stable", () => {
    expect(loadTrend(290, 287).direction).toBe("stable");
    expect(loadTrend(287, 287).delta_pct).toBe(0);
  });
  test("no previous week: no percentage, increased only if something was trained", () => {
    expect(loadTrend(120, 0)).toEqual({ current: 120, previous: 0, delta_pct: null, direction: "increased" });
    expect(loadTrend(0, 0).direction).toBe("stable");
  });
});

describe("sumLoad / dailyLoad", () => {
  const entries = [
    { day: "2026-09-01", load: 40 },
    { day: "2026-09-03", load: 70 },
    { day: "2026-09-03", load: 20 },
    { day: "2026-09-08", load: 55 },
  ];
  test("sums inclusively over a day range", () => {
    expect(sumLoad(entries, "2026-09-01", "2026-09-07")).toBe(130);
    expect(sumLoad(entries, "2026-09-08", "2026-09-14")).toBe(55);
    expect(sumLoad(entries, "2026-09-09", "2026-09-14")).toBe(0);
  });
  test("fills every requested day, merging same-day sessions", () => {
    expect(dailyLoad(entries, ["2026-09-02", "2026-09-03", "2026-09-04"])).toEqual([
      { day: "2026-09-02", load: 0 },
      { day: "2026-09-03", load: 90 },
      { day: "2026-09-04", load: 0 },
    ]);
  });
});
