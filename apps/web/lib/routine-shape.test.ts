import { describe, expect, it } from "vitest";
import { validateProgram } from "@healthapp/shared";
import { toProgramShape } from "./routine-shape";

const exercise = {
  id: "r1", exercise_id: "bench", name: "Bench", position: 0, circuit: null,
  target_sets: 3, target_reps: "8", target_weight_kg: null, target_rpe: 0, rest_seconds: 90,
  set_type: "normal", notes: null, equipment: "barbell", exercise_known: true,
};

describe("toProgramShape", () => {
  it("carries the intensity scale and every prescription the validator reads", () => {
    const shape = toProgramShape({
      intensity_mode: "rir",
      days: [{ id: "d1", name: "Push", week_index: 1, day_index: 1, muscle_groups: [], exercises: [exercise] }],
    });
    expect(shape).toEqual({
      intensity_mode: "rir",
      days: [{
        id: "d1", name: "Push",
        exercises: [{
          id: "r1", exercise_id: "bench", exercise_known: true, position: 0, target_sets: 3, target_reps: "8",
          target_weight_kg: null, target_rpe: 0, rest_seconds: 90, circuit: null, set_type: "normal",
        }],
      }],
    });
    expect(validateProgram(shape).errors).toEqual([]);
  });

  it("passes an orphan prescription through so the validator can name it", () => {
    const shape = toProgramShape({
      intensity_mode: "rpe",
      days: [{ id: "d1", name: "Push", week_index: 1, day_index: 1, muscle_groups: [], exercises: [{ ...exercise, exercise_known: false, target_rpe: 8 }] }],
    });
    expect(validateProgram(shape).errors.map((e) => e.code)).toEqual(["unknown_exercise"]);
  });
});
