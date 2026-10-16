// The app half of one volume rule. supabase/tests/warmup_volume.test.sql logs
// these six sets in one session and expects every SQL rollup (fitness score,
// leaderboards, challenges, achievements, workout posts) to say 3600 kg over
// 6 sets; here the app's own functions must say the same about the same sets.
import { describe, expect, it } from "vitest";
import { totalVolume } from "./exercise-analytics";
import { trainingLoad, trainingLoadFromStats } from "./training-load";

const SESSION = [
  { weight_kg: 40, reps: 10, rpe: 8, warmup: true },
  { weight_kg: 40, reps: 10, rpe: 8, warmup: true },
  { weight_kg: 100, reps: 10, rpe: 8 },
  { weight_kg: 100, reps: 10, rpe: 8 },
  { weight_kg: 100, reps: 10, rpe: 8 },
  // logged outside a program: no prescription, so a working set
  { weight_kg: 60, reps: 10, rpe: 8 },
];

describe("warm-up volume parity with SQL (20261202100000)", () => {
  it("totalVolume leaves the warm-ups out: 3600 kg", () => {
    expect(totalVolume(SESSION)).toBe(3600);
  });

  it("trainingLoad counts six sets and 3600 kg — the stats SQL hands training_load_score()", () => {
    const load = trainingLoad({ sets: SESSION, duration_min: 60, exercise_count: 1 });
    expect(load.volume_kg).toBe(3600);
    expect(load.sets).toBe(6);
    expect(load.score).toBe(trainingLoadFromStats({ volume_kg: 3600, sets: 6, duration_min: 60, intensity: 8, exercises: 1 }).score);
  });
});
