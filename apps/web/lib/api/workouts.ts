import "server-only";
import type { LoggedSetV1, WorkoutDaySummaryV1, WorkoutDayV1, WorkoutExerciseV1 } from "@healthapp/api/v1";
import type { PreviousWorkout } from "@healthapp/shared";
import type { ClientWorkoutDay, Profile } from "@/lib/types";

// The web's training reads (lib/client-training.ts) mapped onto the /api/v1
// contract. Only the mapping lives here — every number comes from the same
// functions the /workout pages render.

export function daySummary(day: ClientWorkoutDay): WorkoutDaySummaryV1 {
  return {
    day_id: day.day_id,
    day_name: day.day_name,
    exercise_count: day.exercises.length,
    completed: day.completed,
    in_progress: !day.completed && day.logged.length > 0,
  };
}

export function workoutDay(
  day: ClientWorkoutDay,
  previous: Map<string, PreviousWorkout>,
  profile: Pick<Profile, "rest_prefs" | "weight_unit">,
): WorkoutDayV1 {
  const exercises: WorkoutExerciseV1[] = day.exercises.map((e) => ({
    id: e.id,
    exercise_id: e.exercise_id ?? null,
    name: e.exercise,
    sets: e.sets,
    reps: e.reps,
    weight_kg: e.weight_kg,
    target_rpe: e.rpe_value,
    rest_seconds: e.rest_seconds,
    position: e.position,
    circuit: e.circuit,
    measure: e.measure === "time" ? "time" : "reps",
    notes: e.notes ?? null,
  }));
  const logged: LoggedSetV1[] = day.logged.map((s) => ({
    program_exercise_id: s.program_exercise_id,
    set_index: s.set_index,
    weight_kg: s.weight_kg,
    reps: s.reps,
    duration_seconds: s.duration_seconds ?? null,
    rpe: s.rpe,
    rir: s.rir,
    notes: s.notes,
    is_pr: s.is_pr,
    at: s.at,
  }));
  return {
    day_id: day.day_id,
    day_name: day.day_name,
    program_id: day.program_id,
    program_name: day.program_name,
    intensity_mode: day.intensity_mode,
    exercises,
    logged,
    completed: day.completed,
    previous: Object.fromEntries(
      [...previous].map(([exerciseId, p]) => [
        exerciseId,
        {
          at: p.at,
          sets: p.sets.map((s) => ({
            set_index: s.set_index,
            weight_kg: s.weight_kg,
            reps: s.reps,
            duration_seconds: s.duration_seconds ?? null,
            rpe: s.rpe,
            rir: s.rir,
          })),
        },
      ]),
    ),
    rest: {
      default_seconds: profile.rest_prefs.default_seconds,
      alert: profile.rest_prefs.alert,
      exercises: profile.rest_prefs.exercises,
    },
    weight_unit: profile.weight_unit,
  };
}
