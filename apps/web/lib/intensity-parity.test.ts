// Training-load intensity: TypeScript ↔ SQL parity.
//
// The bug this pins: SQL averaged least(10, greatest(1, coalesce(rpe, 10 - rir)))
// and greatest(1, NULL) is 1 in Postgres, so a set with neither RPE nor RIR
// counted as "RPE 1". effectiveRpe() says such a set has no intensity.
//
// CASES below are transcribed into supabase/tests/intensity_null.test.sql,
// which asserts the numbers pinned here against challenge_progress_rows() and
// social_leaderboard(). Intermediate values (sets, volume, exercises, mean
// intensity) are pinned as well as the final load, so a wrong intensity cannot
// hide behind a coincidentally equal score.
import { describe, expect, it } from "vitest";
import { effectiveRpe, trainingLoad, trainingLoadFromStats } from "@healthapp/shared";
import { loadOf } from "./training-load";

/** [exercise, kg (null = not recorded), reps, rpe, rir] */
type CaseSet = [exercise: string, kg: number | null, reps: number, rpe: number | null, rir: number | null];
type CaseSession = { daysAgo: number; minutes: number; completed: boolean; sets: CaseSet[] };

export const CASES: Record<string, CaseSession[]> = {
  // RPE only: unchanged by the fix.
  rpe: [{ daysAgo: 1, minutes: 50, completed: true, sets: [["A", 100, 5, 8, null], ["A", 100, 5, 9, null]] }],
  // RIR only: 10 − RIR, unchanged by the fix.
  rir: [{ daysAgo: 1, minutes: 50, completed: true, sets: [["A", 100, 5, null, 2], ["A", 100, 5, null, 1]] }],
  // The bug: no RPE, no RIR. Was intensity 1; must be "no intensity".
  none: [{ daysAgo: 1, minutes: 50, completed: true, sets: [["A", 100, 5, null, null], ["A", 100, 5, null, null]] }],
  // Everything at once: RPE, RIR, both (RPE wins), neither, bodyweight,
  // reps = 0 (ignored for intensity, volume and the set count), a weight that
  // was never recorded (NULL) and a negative one (both count as 0 kg).
  mix: [{ daysAgo: 2, minutes: 60, completed: true, sets: [
    ["A", 100, 5, 8, null],
    ["A", 100, 5, null, 2],
    ["A", 80, 5, 7, 1],
    ["A", 100, 5, null, null],
    ["A", 0, 12, null, null],
    ["A", 50, 0, 10, null],
    ["B", null, 10, 6, null],
    ["B", -5, 10, null, null],
  ] }],
  // Two sessions on one day: two rows, two loads.
  sameday: [
    { daysAgo: 3, minutes: 40, completed: true, sets: [["A", 60, 10, null, null]] },
    { daysAgo: 3, minutes: 30, completed: true, sets: [["A", 60, 10, 7, null]] },
  ],
  // Outside the challenge window (20 days ago, window is 10) and unfinished.
  window: [
    { daysAgo: 20, minutes: 50, completed: true, sets: [["A", 100, 5, 8, null]] },
    { daysAgo: 1, minutes: 50, completed: false, sets: [["A", 100, 5, 8, null]] },
  ],
};

/** What the SQL rollup produces per session, computed the TypeScript way. */
function rollup(s: CaseSession) {
  const started = "2026-09-20T09:00:00.000Z";
  const completed = new Date(new Date(started).getTime() + s.minutes * 60_000).toISOString();
  const sets = s.sets.map(([exercise, kg, reps, rpe, rir]) => ({ exercise, weight_kg: kg, reps, rpe, rir }));
  const load = loadOf(sets, started, s.completed ? completed : null);
  const worked = s.sets.filter(([, , reps]) => reps > 0);
  const rpes = worked.map(([, , , rpe, rir]) => effectiveRpe({ rpe, rir })).filter((r): r is number => r !== null);
  return {
    sets: worked.length,
    volume: worked.reduce((sum, [, kg, reps]) => sum + Math.max(0, kg ?? 0) * reps, 0),
    intensity: rpes.length ? rpes.reduce((a, b) => a + b, 0) / rpes.length : null,
    exercises: new Set(s.sets.map(([e]) => e)).size,
    load: load.score,
  };
}

/** Pinned numbers — supabase/tests/intensity_null.test.sql asserts the same. */
export const EXPECTED = {
  rpe: { sets: 2, volume: 1000, intensity: 8.5, exercises: 1, load: 28 },
  rir: { sets: 2, volume: 1000, intensity: 8.5, exercises: 1, load: 28 },
  none: { sets: 2, volume: 1000, intensity: null, exercises: 1, load: 20 },
  mix: { sets: 7, volume: 1900, intensity: 7.25, exercises: 2, load: 36 },
  sameday: [
    { sets: 1, volume: 600, intensity: null, exercises: 1, load: 15 },
    { sets: 1, volume: 600, intensity: 7, exercises: 1, load: 19 },
  ],
  windowOld: { sets: 1, volume: 500, intensity: 8, exercises: 1, load: 23 },
} as const;

/**
 * What the OLD SQL produced for the cases the bug touches: every set without
 * RPE/RIR averaged in as 1. Kept to show the before/after, and asserted on the
 * SQL side by recomputing the old expression.
 */
export const BEFORE = {
  none: { intensity: 1, load: 17 },
  mix: { intensity: 32 / 7, load: 29 },
  samedayFirst: { intensity: 1, load: 12 },
} as const;

describe("effectiveRpe — the per-set rule effective_rpe() mirrors", () => {
  it("uses the RPE when there is one", () => {
    expect(effectiveRpe({ rpe: 8, rir: null })).toBe(8);
    expect(effectiveRpe({ rpe: 7, rir: 1 })).toBe(7);
  });
  it("falls back to 10 − RIR", () => {
    expect(effectiveRpe({ rpe: null, rir: 2 })).toBe(8);
    expect(effectiveRpe({ rpe: null, rir: 0 })).toBe(10);
    expect(effectiveRpe({ rpe: null, rir: 10 })).toBe(1);
  });
  it("has no value when both are missing — never 1", () => {
    expect(effectiveRpe({ rpe: null, rir: null })).toBeNull();
  });
});

describe("intensity parity cases (mirrored in intensity_null.test.sql)", () => {
  for (const key of ["rpe", "rir", "none", "mix"] as const) {
    it(`${key}: intermediates and load`, () => {
      const got = rollup(CASES[key]![0]!);
      const want = EXPECTED[key];
      expect(got.sets).toBe(want.sets);
      expect(got.volume).toBe(want.volume);
      expect(got.intensity).toBe(want.intensity);
      expect(got.exercises).toBe(want.exercises);
      expect(got.load).toBe(want.load);
    });
  }

  it("sameday: each session is scored on its own", () => {
    CASES.sameday!.forEach((s, i) => {
      const got = rollup(s);
      expect(got).toMatchObject(EXPECTED.sameday[i]!);
    });
  });

  it("window: the finished session 20 days ago is scored; the unfinished one scores nothing", () => {
    expect(rollup(CASES.window![0]!)).toMatchObject(EXPECTED.windowOld);
  });

  it("before → after: what treating a missing intensity as RPE 1 cost each case", () => {
    const old = (volume_kg: number, sets: number, duration_min: number, intensity: number, exercises: number) =>
      trainingLoadFromStats({ volume_kg, sets, duration_min, intensity, exercises }).score;
    expect(old(1000, 2, 50, BEFORE.none.intensity, 1)).toBe(BEFORE.none.load);
    expect(old(1900, 7, 60, BEFORE.mix.intensity, 2)).toBe(BEFORE.mix.load);
    expect(old(600, 1, 40, BEFORE.samedayFirst.intensity, 1)).toBe(BEFORE.samedayFirst.load);
    expect([EXPECTED.none.load, EXPECTED.mix.load, EXPECTED.sameday[0].load]).toEqual([20, 36, 15]);
  });

  it("the bug case differs from what 'RPE 1' would have produced", () => {
    // What the old SQL fed training_load_score(): intensity 1 for every set.
    const asIfRpe1 = trainingLoadFromStats({ volume_kg: 1000, sets: 2, duration_min: 50, intensity: 1, exercises: 1 }).score;
    expect(asIfRpe1).not.toBe(EXPECTED.none.load);
    // And "no intensity" is exactly what the TS engine does when the signal is absent.
    expect(trainingLoad({ sets: [{ weight_kg: 100, reps: 5 }, { weight_kg: 100, reps: 5 }], duration_min: 50, exercise_count: 1 }).score)
      .toBe(EXPECTED.none.load);
  });
});
