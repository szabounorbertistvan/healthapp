import type { WorkoutDayV1, WorkoutExerciseV1 } from "@healthapp/api/v1";
import { describe, expect, it } from "vitest";
import { firstNumber, loggedCount, nextSetIndex, parseDecimal, prefill, setsByExercise } from "./logger-model";
import type { QueuedSet } from "./outbox-core";

const squat: WorkoutExerciseV1 = {
  id: "pe-1", exercise_id: "ex-1", name: "Squat", sets: 3, reps: "8-10", weight_kg: 60, target_rpe: 2,
  rest_seconds: 90, position: 0, circuit: null, measure: "reps", notes: null,
};
const plank: WorkoutExerciseV1 = { ...squat, id: "pe-2", exercise_id: "ex-2", name: "Plank", reps: "45", weight_kg: null, measure: "time" };

function day(over: Partial<WorkoutDayV1> = {}): WorkoutDayV1 {
  return {
    day_id: "day-1", day_name: "Day 1", program_id: "p", program_name: "P", intensity_mode: "rir",
    exercises: [squat, plank], logged: [], completed: false, previous: {},
    rest: { default_seconds: 60, alert: true, exercises: {} }, weight_unit: "kg", ...over,
  };
}
const queued = (setIndex: number, error?: string): QueuedSet => ({
  kind: "set", id: `q${setIndex}`, userId: "me", queuedAt: "2026-10-23T10:00:00Z", error,
  input: { dayId: "day-1", dayName: "Day 1", exerciseName: "Squat", exerciseId: "ex-1", programExerciseId: "pe-1",
    setIndex, weightKg: 62.5, reps: 6, rpe: 8, rir: 2, loggedAt: `2026-10-23T10:0${setIndex}:00Z` },
});
const serverSet = (setIndex: number) => ({
  program_exercise_id: "pe-1", set_index: setIndex, weight_kg: 60, reps: 8, duration_seconds: null,
  rpe: 8, rir: 2, notes: null, is_pr: setIndex === 1, at: `2026-10-23T09:0${setIndex}:00Z`,
});

describe("setsByExercise", () => {
  it("lists the server's sets, then the phone's waiting ones, in set order", () => {
    const sets = setsByExercise(day({ logged: [serverSet(1)] }), [queued(2)]);
    expect(sets["pe-1"]!.map((s) => [s.set_index, s.state])).toEqual([[1, "synced"], [2, "pending"]]);
    expect(sets["pe-2"]).toEqual([]);
  });

  it("shows a set once when it is both delivered and still in the outbox", () => {
    const sets = setsByExercise(day({ logged: [serverSet(1)] }), [{ ...queued(1) }]);
    expect(sets["pe-1"]!).toHaveLength(1);
    expect(sets["pe-1"]![0]!.state).toBe("synced");
  });

  it("marks a refused set and keeps its number free", () => {
    const sets = setsByExercise(day({ logged: [serverSet(1)] }), [queued(2, "Reps must be 1–100")]);
    expect(sets["pe-1"]![1]!.state).toBe("refused");
    expect(nextSetIndex(sets["pe-1"]!)).toBe(2);
    expect(loggedCount(sets)).toEqual({ "pe-1": 1, "pe-2": 0 });
  });

  it("ignores another day's sets", () => {
    const other = { ...queued(1), input: { ...queued(1).input, dayId: "day-2" } };
    expect(setsByExercise(day(), [other])["pe-1"]).toEqual([]);
  });
});

describe("prefill", () => {
  it("repeats today's last set", () => {
    const sets = setsByExercise(day({ logged: [serverSet(1)] }), []);
    expect(prefill(squat, sets["pe-1"]!, {}, "kg")).toEqual({ weight: "60", reps: "8" });
  });

  it("else the same set of last time, in the person's unit", () => {
    const previous = { "ex-1": { at: "2026-10-20", sets: [
      { set_index: 1, weight_kg: 100, reps: 5, duration_seconds: null, rpe: null, rir: null },
      { set_index: 2, weight_kg: 102.5, reps: 4, duration_seconds: null, rpe: null, rir: null },
    ] } };
    expect(prefill(squat, [], previous, "kg")).toEqual({ weight: "100", reps: "5" });
    // kgToDisplay rounds to 0.1, as on the web
    expect(prefill(squat, [], previous, "lb").weight).toBe("220.5");
  });

  it("else the prescription; seconds for a timed exercise", () => {
    expect(prefill(squat, [], {}, "kg")).toEqual({ weight: "60", reps: "8" });
    expect(prefill(plank, [], {}, "kg")).toEqual({ weight: "", reps: "45" });
  });
});

describe("numbers as typed", () => {
  it("reads a decimal comma and refuses junk", () => {
    expect(parseDecimal("62,5")).toBe(62.5);
    expect(parseDecimal(" 60 ")).toBe(60);
    expect(parseDecimal("6O")).toBeNaN();
    expect(parseDecimal("")).toBeNaN();
  });

  it("takes the first number of a rep range", () => {
    expect(firstNumber("8-10")).toBe(8);
    expect(firstNumber("AMRAP")).toBeNull();
  });
});
