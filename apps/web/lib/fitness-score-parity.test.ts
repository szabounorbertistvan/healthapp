// The Fitness Score has two implementations that must agree to the point:
// fitnessScore() in packages/shared (what every screen shows) and
// fitness_score_of() in SQL (what publishing and sharing trust, because the
// database cannot take the browser's word for a number).
//
// This file and supabase/tests/social_v2_cleanup.test.sql score the SAME
// sessions — FIXTURE below, transcribed into SQL there — and assert the same
// numbers. Change one side and the other test fails.
import { describe, expect, it } from "vitest";
import { fitnessScore, fitnessScoreMilestone, shiftDays } from "@healthapp/shared";
import { loadOf, type LoadSetInput } from "./training-load";

const TZ = "Europe/Bucharest";
const TODAY = "2026-09-23";

type FixtureSet = [exercise: string, weight: number, reps: number, rpe: number | null, rir: number | null];
type FixtureSession = { daysAgo: number; minutes: number; completed: boolean; sets: FixtureSet[] };

/**
 * Every branch of the formula at least once: RPE and RIR sets, a set with
 * neither, bodyweight (0 kg), a reps = 0 set (counts as an exercise only),
 * two sessions on one day (two workouts, one active day), an untimed
 * 400-minute session (duration drops out), a session with no sets, one
 * outside the 28-day window, and one never finished.
 */
export const FIXTURE: FixtureSession[] = [
  { daysAgo: 1, minutes: 55, completed: true, sets: [
    ["A", 100, 5, 8, null], ["A", 100, 5, 8, null], ["A", 100, 5, 9, null], ["B", 60, 10, null, 2], ["B", 60, 10, null, 2],
  ] },
  { daysAgo: 2, minutes: 70, completed: true, sets: [
    ["A", 80, 8, 7, null], ["C", 20, 12, null, null], ["C", 20, 12, null, null], ["C", 0, 15, null, null], ["D", 50, 0, null, null],
  ] },
  { daysAgo: 2, minutes: 30, completed: true, sets: [["B", 70, 6, 10, null]] },
  { daysAgo: 5, minutes: 45, completed: true, sets: [["A", 120, 3, 9, null], ["A", 120, 3, 9, null], ["B", 65, 8, null, 1]] },
  { daysAgo: 9, minutes: 400, completed: true, sets: [["A", 90, 5, 8, null]] },
  { daysAgo: 20, minutes: 40, completed: true, sets: [] },
  { daysAgo: 35, minutes: 50, completed: true, sets: [["A", 200, 5, 10, null]] },
  { daysAgo: 3, minutes: 50, completed: false, sets: [["A", 300, 10, 10, null]] },
];

/** Local noon on the given day in Bucharest, as an ISO instant (UTC+3 in September). */
function localNoon(day: string): string {
  return `${day}T09:00:00.000Z`;
}

function scoreFixture() {
  const sessions = FIXTURE.map((s) => {
    const started = localNoon(shiftDays(TODAY, -s.daysAgo));
    const completed = s.completed ? new Date(new Date(started).getTime() + s.minutes * 60_000).toISOString() : null;
    const sets: LoadSetInput[] = s.sets.map(([exercise, weight_kg, reps, rpe, rir]) => ({ exercise, weight_kg, reps, rpe, rir }));
    const load = loadOf(sets, started, completed);
    return { started_at: started, completed_at: completed, load: load.score, volume_kg: load.volume_kg };
  });
  return fitnessScore({ sessions, timeZone: TZ, today: TODAY, periodsAgo: 0 });
}

/**
 * The numbers social_v2_cleanup.test.sql asserts for fitness_score_of() on the
 * same sessions. If the formula changes on purpose, change both files.
 */
export const EXPECTED = {
  score: 33,
  band: "getting_started",
  completedWorkouts: 6,
  activeWorkoutDays: 5,
  totalVolume: 5930,
  averageTrainingLoad: 143 / 6,
  milestone: 25,
} as const;

describe("Fitness Score parity fixture (mirrored in social_v2_cleanup.test.sql)", () => {
  const f = scoreFixture();

  it("scores the fixture to the pinned numbers", () => {
    expect(f.status).toBe("active");
    expect(f.score).toBe(EXPECTED.score);
    expect(f.band).toBe(EXPECTED.band);
    expect(f.completedWorkouts).toBe(EXPECTED.completedWorkouts);
    expect(f.activeWorkoutDays).toBe(EXPECTED.activeWorkoutDays);
    expect(f.totalVolume).toBe(EXPECTED.totalVolume);
    expect(f.averageTrainingLoad).toBeCloseTo(EXPECTED.averageTrainingLoad, 12);
  });

  it("the milestone a share would carry comes from that score", () => {
    expect(fitnessScoreMilestone(f.score!)).toBe(EXPECTED.milestone);
  });

  it("excludes the unfinished session and the one outside the window", () => {
    // Were either counted, there would be 7 or 8 workouts and far more volume.
    expect(f.completedWorkouts).toBe(6);
    expect(f.period).toEqual({ start: "2026-08-27", end: TODAY });
  });
});
