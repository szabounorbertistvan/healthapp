import { describe, expect, it } from "vitest";
import { nextLoadKg, nextSetAdvice, parseRepRange } from "./progression-advice";
import type { PerformedSetRow, PreviousWorkout } from "./exercise-analytics";

function set(set_index: number, weight_kg: number, reps: number, extra: Partial<PerformedSetRow> = {}): PerformedSetRow {
  return { set_index, weight_kg, reps, rpe: 8, rir: null, is_pr: false, ...extra };
}
function prev(...sets: PerformedSetRow[]): PreviousWorkout {
  return { session_id: "s1", at: "2026-10-10T10:00:00Z", sets };
}

describe("parseRepRange", () => {
  it("reads a range, a single number and the dash variants", () => {
    expect(parseRepRange("8-10")).toEqual({ lo: 8, hi: 10 });
    expect(parseRepRange("8 – 10")).toEqual({ lo: 8, hi: 10 });
    expect(parseRepRange("5")).toEqual({ lo: 5, hi: 5 });
  });
  it("refuses what is not a range", () => {
    expect(parseRepRange("AMRAP")).toBeNull();
    expect(parseRepRange("")).toBeNull();
    expect(parseRepRange("10-8")).toBeNull();
    expect(parseRepRange("0")).toBeNull();
  });
});

describe("nextLoadKg", () => {
  it("adds 2.5 kg on a bar and 1 kg under 20 kg", () => {
    expect(nextLoadKg(60, "kg")).toBe(62.5);
    expect(nextLoadKg(12, "kg")).toBe(13);
  });
  it("adds 5 lb for pound users, landing on a clean pound figure", () => {
    const kg = nextLoadKg(135 / 2.2046226218487757, "lb");
    expect(Math.round(kg * 2.2046226218487757 * 10) / 10).toBe(140);
  });
});

describe("nextSetAdvice", () => {
  const base = { setNumber: 1, unit: "kg" as const };

  it("says nothing without a previous session", () => {
    expect(nextSetAdvice({ ...base, previous: null, targetReps: "8-10" })).toBeNull();
  });

  it("adds load at the top of the range and drops to the bottom", () => {
    const a = nextSetAdvice({ ...base, previous: prev(set(1, 60, 10)), targetReps: "8-10" });
    expect(a).toMatchObject({ weight_kg: 62.5, reps: 8, reason: "add_weight" });
  });

  it("adds a rep inside the range", () => {
    const a = nextSetAdvice({ ...base, previous: prev(set(1, 60, 8)), targetReps: "8-10" });
    expect(a).toMatchObject({ weight_kg: 60, reps: 9, reason: "add_rep" });
  });

  it("holds the load and aims for the bottom after a miss", () => {
    const a = nextSetAdvice({ ...base, previous: prev(set(1, 60, 6)), targetReps: "8-10" });
    expect(a).toMatchObject({ weight_kg: 60, reps: 8, reason: "hold_missed" });
  });

  it("repeats a max effort, even at the top of the range", () => {
    expect(nextSetAdvice({ ...base, previous: prev(set(1, 60, 10, { rpe: 10 })), targetReps: "8-10" }))
      .toMatchObject({ weight_kg: 60, reps: 10, reason: "hold_hard" });
    expect(nextSetAdvice({ ...base, previous: prev(set(1, 60, 10, { rir: 0, rpe: 7 })), targetReps: "8-10" }))
      .toMatchObject({ reason: "hold_hard" });
  });

  it("trusts a typed RIR over the slider", () => {
    const a = nextSetAdvice({ ...base, previous: prev(set(1, 60, 10, { rir: 2, rpe: 10 })), targetReps: "8-10" });
    expect(a?.reason).toBe("add_weight");
  });

  it("answers the same set number of a descending block", () => {
    const p = prev(set(1, 110, 8), set(2, 105, 9), set(3, 100, 10));
    expect(nextSetAdvice({ ...base, setNumber: 2, previous: p, targetReps: "8-10" }))
      .toMatchObject({ weight_kg: 105, reps: 10, reason: "add_rep" });
  });

  it("adds reps, never load, to a bodyweight set", () => {
    const a = nextSetAdvice({ ...base, previous: prev(set(1, 0, 12)), targetReps: "8-12" });
    expect(a).toMatchObject({ weight_kg: 0, reps: 13, reason: "add_rep" });
  });

  it("adds a rep when the coach gave no range", () => {
    const a = nextSetAdvice({ ...base, previous: prev(set(1, 40, 15)), targetReps: "AMRAP" });
    expect(a).toMatchObject({ weight_kg: 40, reps: 16, reason: "add_rep" });
  });

  it("stays out of timed sets", () => {
    const p = prev(set(1, 0, 0, { duration_seconds: 45 }));
    expect(nextSetAdvice({ ...base, previous: p, targetReps: "45" })).toBeNull();
  });
});
