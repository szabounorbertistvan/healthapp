import { describe, expect, test } from "vitest";
import {
  CONSISTENCY_TARGET_DAYS,
  FITNESS_SCORE_MIN_WORKOUTS,
  FITNESS_SCORE_PERIOD_DAYS,
  FITNESS_SCORE_WEIGHTS,
  FREQUENCY_TARGET_WORKOUTS,
  TRAINING_LOAD_SCALE,
  VOLUME_REFERENCE_KG,
  fitnessScore,
  fitnessScoreBand,
  fitnessScoreTrend,
  fitnessScoreWindow,
  type FitnessScoreSession,
} from "./fitness-score";
import { saturate } from "./training-load";
import { shiftDays } from "./weekly-summary";

const TZ = "Europe/Bucharest";
const TODAY = "2026-09-16";

/** A completed session at local noon on `day` (Bucharest is UTC+3 in September). */
function session(day: string, over: Partial<FitnessScoreSession> & { hourUtc?: number } = {}): FitnessScoreSession {
  const hour = over.hourUtc ?? 9;
  const started_at = `${day}T${String(hour).padStart(2, "0")}:00:00Z`;
  return {
    started_at,
    completed_at: over.completed_at === undefined ? `${day}T${String(hour).padStart(2, "0")}:50:00Z` : over.completed_at,
    load: over.load ?? 60,
    volume_kg: over.volume_kg ?? 2000,
  };
}

/** `n` sessions on `n` distinct days ending yesterday, one per day. */
function sessionsOnDays(n: number, over: Partial<FitnessScoreSession> = {}): FitnessScoreSession[] {
  return Array.from({ length: n }, (_, i) => session(shiftDays(TODAY, -1 - i), over));
}

function score(sessions: FitnessScoreSession[], periodsAgo = 0) {
  return fitnessScore({ sessions, timeZone: TZ, today: TODAY, periodsAgo });
}

describe("constants", () => {
  test("the four weights sum to one", () => {
    const sum = Object.values(FITNESS_SCORE_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 10);
    expect(FITNESS_SCORE_WEIGHTS).toEqual({ trainingLoad: 0.35, consistency: 0.25, frequency: 0.2, volume: 0.2 });
  });
  test("targets are the spec's 4/week over 28 days", () => {
    expect(FITNESS_SCORE_PERIOD_DAYS).toBe(28);
    expect(CONSISTENCY_TARGET_DAYS).toBe(16);
    expect(FREQUENCY_TARGET_WORKOUTS).toBe(16);
    expect(VOLUME_REFERENCE_KG).toBe(50_000);
    expect(FITNESS_SCORE_MIN_WORKOUTS).toBe(3);
  });
});

describe("window", () => {
  test("the current window is the 28 local days ending today, inclusive", () => {
    expect(fitnessScoreWindow(TODAY)).toEqual({ start: "2026-08-20", end: "2026-09-16" });
  });
  test("the previous window is the 28 days before that, with no gap and no overlap", () => {
    const current = fitnessScoreWindow(TODAY, 0);
    const previous = fitnessScoreWindow(TODAY, 1);
    expect(previous).toEqual({ start: "2026-07-23", end: "2026-08-19" });
    expect(shiftDays(previous.end, 1)).toBe(current.start);
  });
});

describe("zero activity", () => {
  test("no sessions → building, every component zero", () => {
    const r = score([]);
    expect(r).toEqual({
      score: null,
      status: "building",
      band: null,
      trainingLoadScore: 0,
      consistencyScore: 0,
      frequencyScore: 0,
      volumeScore: 0,
      periodDays: 28,
      period: { start: "2026-08-20", end: "2026-09-16" },
      activeWorkoutDays: 0,
      completedWorkouts: 0,
      totalVolume: 0,
      averageTrainingLoad: 0,
    });
  });
  test("unfinished sessions are not workouts", () => {
    const r = score([session("2026-09-15", { completed_at: null }), session("2026-09-14", { completed_at: null })]);
    expect(r.completedWorkouts).toBe(0);
    expect(r.activeWorkoutDays).toBe(0);
    expect(r.totalVolume).toBe(0);
  });
});

describe("insufficient data", () => {
  test("two workouts → building, but the components are still computed", () => {
    const r = score(sessionsOnDays(2, { load: 50, volume_kg: 1000 }));
    expect(r.status).toBe("building");
    expect(r.score).toBeNull();
    expect(r.band).toBeNull();
    expect(r.completedWorkouts).toBe(2);
    expect(r.activeWorkoutDays).toBe(2);
    expect(r.totalVolume).toBe(2000);
    expect(r.averageTrainingLoad).toBe(50);
    expect(r.frequencyScore).toBeCloseTo(12.5);
    expect(r.consistencyScore).toBeCloseTo(12.5);
  });
  test("exactly three workouts → active with a number", () => {
    const r = score(sessionsOnDays(3));
    expect(r.status).toBe("active");
    expect(r.completedWorkouts).toBe(3);
    expect(typeof r.score).toBe("number");
    expect(r.band).not.toBeNull();
  });
  test("three workouts on one day still count as three workouts", () => {
    const day = shiftDays(TODAY, -1);
    const r = score([session(day, { hourUtc: 6 }), session(day, { hourUtc: 9 }), session(day, { hourUtc: 12 })]);
    expect(r.completedWorkouts).toBe(3);
    expect(r.activeWorkoutDays).toBe(1);
    expect(r.status).toBe("active");
  });
});

describe("consistency (active workout days)", () => {
  test("8 active days → 50", () => {
    expect(score(sessionsOnDays(8)).consistencyScore).toBeCloseTo(50);
  });
  test("16 active days → 100", () => {
    expect(score(sessionsOnDays(16)).consistencyScore).toBeCloseTo(100);
  });
  test("more than 16 active days is capped at 100", () => {
    const r = score(sessionsOnDays(24));
    expect(r.activeWorkoutDays).toBe(24);
    expect(r.consistencyScore).toBe(100);
  });
  test("two workouts on one day are one active day", () => {
    const day = shiftDays(TODAY, -1);
    const r = score([session(day, { hourUtc: 6 }), session(day, { hourUtc: 12 }), ...sessionsOnDays(3).slice(1)]);
    expect(r.activeWorkoutDays).toBe(3);
    expect(r.completedWorkouts).toBe(4);
  });
});

describe("frequency (completed workouts)", () => {
  test("8 workouts → 50", () => {
    expect(score(sessionsOnDays(8)).frequencyScore).toBeCloseTo(50);
  });
  test("16 workouts → 100", () => {
    expect(score(sessionsOnDays(16)).frequencyScore).toBeCloseTo(100);
  });
  test("more than 16 workouts is capped at 100", () => {
    const r = score(sessionsOnDays(20));
    expect(r.completedWorkouts).toBe(20);
    expect(r.frequencyScore).toBe(100);
  });
});

describe("volume", () => {
  test("no weight lifted → 0", () => {
    expect(score(sessionsOnDays(4, { volume_kg: 0 })).volumeScore).toBe(0);
  });
  test("linear to the 50,000 kg reference", () => {
    expect(score(sessionsOnDays(4, { volume_kg: 6250 })).volumeScore).toBeCloseTo(50);
    expect(score(sessionsOnDays(4, { volume_kg: 12_500 })).volumeScore).toBeCloseTo(100);
  });
  test("above the reference is capped at 100", () => {
    const r = score(sessionsOnDays(4, { volume_kg: 20_000 }));
    expect(r.totalVolume).toBe(80_000);
    expect(r.volumeScore).toBe(100);
  });
  test("negative or missing volume on a session counts as zero", () => {
    const r = score([session("2026-09-15", { volume_kg: -5 }), session("2026-09-14", { volume_kg: Number.NaN }), session("2026-09-13", { volume_kg: 100 })]);
    expect(r.totalVolume).toBe(100);
    expect(r.volumeScore).toBeCloseTo(0.2);
  });
});

describe("training load", () => {
  test("the subscore is the existing saturation curve over the average session load", () => {
    const r = score(sessionsOnDays(4, { load: 61 }));
    expect(r.averageTrainingLoad).toBe(61);
    expect(r.trainingLoadScore).toBeCloseTo(saturate(61, TRAINING_LOAD_SCALE));
    expect(r.trainingLoadScore).toBeCloseTo(78.24, 1);
  });
  test("average is over completed sessions only", () => {
    const r = score([session("2026-09-15", { load: 80 }), session("2026-09-14", { load: 40 }), session("2026-09-13", { load: 90, completed_at: null })]);
    expect(r.averageTrainingLoad).toBe(60);
  });
  test("missing or invalid load on a session counts as zero", () => {
    const r = score([session("2026-09-15", { load: Number.NaN }), session("2026-09-14", { load: 80 })]);
    expect(r.averageTrainingLoad).toBe(40);
  });
  test("zero load everywhere → 0", () => {
    expect(score(sessionsOnDays(4, { load: 0 })).trainingLoadScore).toBe(0);
  });
});

describe("final score", () => {
  test("weights the four components and rounds only the total", () => {
    // 4 sessions, load 61, 6250 kg each: TL 78.24, consistency 25, frequency 25, volume 50.
    const r = score(sessionsOnDays(4, { load: 61, volume_kg: 6250 }));
    const expected =
      r.trainingLoadScore * 0.35 + r.consistencyScore * 0.25 + r.frequencyScore * 0.2 + r.volumeScore * 0.2;
    expect(r.score).toBe(Math.round(expected));
    expect(r.score).toBe(Math.round(78.24 * 0.35 + 25 * 0.25 + 25 * 0.2 + 50 * 0.2)); // 42
    expect(Number.isInteger(r.trainingLoadScore)).toBe(false); // internals stay precise
  });
  test("everything at target → 100", () => {
    // 16 days × 3,125 kg = 50,000 kg; a load of 400 is impossible but proves the curve saturates.
    const r = score(sessionsOnDays(16, { load: 100, volume_kg: 3125 }));
    expect(r.consistencyScore).toBe(100);
    expect(r.frequencyScore).toBe(100);
    expect(r.volumeScore).toBeCloseTo(100);
    expect(r.trainingLoadScore).toBeLessThan(100);
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.score).toBeGreaterThanOrEqual(0);
  });
  test("is clamped to 0..100 whatever the inputs", () => {
    const r = score(sessionsOnDays(28, { load: 1000, volume_kg: 1_000_000 }));
    expect(r.score).toBe(100);
    expect(r.trainingLoadScore).toBeLessThanOrEqual(100);
    expect(r.volumeScore).toBe(100);
  });
  test("deterministic: the same input always yields the same result", () => {
    const sessions = sessionsOnDays(9, { load: 55, volume_kg: 3300 });
    const a = score(sessions);
    const b = score([...sessions].reverse());
    expect(a).toEqual(b);
    expect(a).toEqual(score(sessions));
  });
});

describe("date boundaries", () => {
  test("a session 28 days ago is outside the window, 27 days ago is inside", () => {
    const inside = session(shiftDays(TODAY, -27));
    const outside = session(shiftDays(TODAY, -28));
    expect(score([inside, outside]).completedWorkouts).toBe(1);
  });
  test("today counts", () => {
    expect(score([session(TODAY)]).completedWorkouts).toBe(1);
  });
  test("the day is where started_at falls in the user's zone, not UTC", () => {
    // 22:30 UTC on the 19th of August is 01:30 on the 20th in Bucharest → inside the window.
    const late = session("2026-08-19", { hourUtc: 22 });
    expect(score([late]).completedWorkouts).toBe(1);
    expect(fitnessScore({ sessions: [late], timeZone: "UTC", today: TODAY }).completedWorkouts).toBe(0);
  });
  test("the previous period picks up only the sessions before the current one", () => {
    const sessions = [session("2026-08-20"), session("2026-08-19"), session("2026-07-23"), session("2026-07-22")];
    expect(score(sessions, 0).completedWorkouts).toBe(1);
    const previous = score(sessions, 1);
    expect(previous.completedWorkouts).toBe(2);
    expect(previous.period).toEqual({ start: "2026-07-23", end: "2026-08-19" });
  });
});

describe("band", () => {
  test("neutral ranges", () => {
    expect(fitnessScoreBand(0)).toBe("getting_started");
    expect(fitnessScoreBand(39)).toBe("getting_started");
    expect(fitnessScoreBand(40)).toBe("building");
    expect(fitnessScoreBand(59)).toBe("building");
    expect(fitnessScoreBand(60)).toBe("developing");
    expect(fitnessScoreBand(79)).toBe("developing");
    expect(fitnessScoreBand(80)).toBe("strong_activity");
    expect(fitnessScoreBand(100)).toBe("strong_activity");
  });
  test("the result carries its band", () => {
    const r = score(sessionsOnDays(4, { load: 61, volume_kg: 6250 }));
    expect(r.band).toBe(fitnessScoreBand(r.score!));
  });
});

describe("trend", () => {
  const active = (n: number) => score(sessionsOnDays(n));
  test("up, down and no change between two active periods", () => {
    const hi = score(sessionsOnDays(12, { load: 70, volume_kg: 3000 }));
    const lo = score(sessionsOnDays(4, { load: 40, volume_kg: 1000 }));
    expect(fitnessScoreTrend(hi, lo)).toEqual({ current: hi.score, previous: lo.score, delta: hi.score! - lo.score!, direction: "up" });
    expect(fitnessScoreTrend(lo, hi)).toEqual({ current: lo.score, previous: hi.score, delta: lo.score! - hi.score!, direction: "down" });
    expect(fitnessScoreTrend(hi, hi)).toEqual({ current: hi.score, previous: hi.score, delta: 0, direction: "stable" });
  });
  test("no delta when either period is still building", () => {
    const building = score([]);
    expect(fitnessScoreTrend(active(4), building)).toEqual({ current: active(4).score, previous: null, delta: null, direction: "stable" });
    expect(fitnessScoreTrend(building, active(4))).toEqual({ current: null, previous: active(4).score, delta: null, direction: "stable" });
  });
  test("previous-period comparison uses the same formula over the earlier window", () => {
    const current = sessionsOnDays(6, { load: 60, volume_kg: 2500 });
    const previous = current.map((s) => ({
      ...s,
      started_at: shiftDays(s.started_at.slice(0, 10), -28) + s.started_at.slice(10),
      completed_at: s.completed_at && shiftDays(s.completed_at.slice(0, 10), -28) + s.completed_at.slice(10),
    }));
    const all = [...current, ...previous];
    expect(score(all, 1).score).toBe(score(all, 0).score);
    expect(fitnessScoreTrend(score(all, 0), score(all, 1)).delta).toBe(0);
  });
});
