import "server-only";
import type { BuilderV1 } from "@healthapp/api/v1";
import type { ProgramDetail } from "@/lib/types";

// A program as the builder edits it on the /api/v1 contract — raw targets, not
// display strings. The client's own builder and the coach's program page share it.
export function builderProgram(
  program: ProgramDetail,
  activation: { published: boolean; followed: boolean } | null,
): NonNullable<BuilderV1["open"]> {
  return {
    id: program.id,
    name: program.name,
    status: program.status,
    intensity_mode: program.intensity_mode,
    activation,
    days: program.days.map((d) => ({
      id: d.id,
      name: d.name,
      muscle_groups: d.muscle_groups,
      exercises: d.exercises.map((e) => ({
        id: e.id,
        exercise: e.exercise,
        sets: e.sets,
        reps: e.reps,
        weight_kg: e.weight_kg,
        rpe: e.rpe_value,
        rest_seconds: e.rest_seconds,
        measure: e.measure === "time" ? "time" : "reps",
        notes: e.notes ?? null,
      })),
    })),
  };
}
