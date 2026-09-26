// A routine as read for its page → the shape validateProgram() checks. Pure
// (type-only import from the server-only reader) so it can be tested.
import type { ProgramShape } from "@healthapp/shared";
import type { RoutineDetail } from "./routine-data";

export function toProgramShape(detail: Pick<RoutineDetail, "intensity_mode" | "days">): ProgramShape {
  return {
    intensity_mode: detail.intensity_mode,
    days: detail.days.map((d) => ({
      id: d.id,
      name: d.name,
      exercises: d.exercises.map((e) => ({
        id: e.id,
        exercise_id: e.exercise_id,
        exercise_known: e.exercise_known,
        position: e.position,
        target_sets: e.target_sets,
        target_reps: e.target_reps,
        target_weight_kg: e.target_weight_kg,
        target_rpe: e.target_rpe,
        rest_seconds: e.rest_seconds,
        circuit: e.circuit,
        set_type: e.set_type,
      })),
    })),
  };
}
