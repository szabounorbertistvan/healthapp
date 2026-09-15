// The eight visual types the brand athlete photos cover
// (public/brand/athletes/type-*.webp, see components/athlete.tsx). Coarser than
// exercises.primary_muscles on purpose: the library uses 17 muscles and a photo
// per muscle would be 17 near-identical shots. Pure; usable on both sides.

export const EXERCISE_TYPES = ["chest", "back", "shoulders", "arms", "legs", "glutes", "core", "cardio"] as const;
export type ExerciseType = (typeof EXERCISE_TYPES)[number];

/** exercises.primary_muscles value → type. Mirrors MUSCLE_GROUPS in muscle-group-picker.tsx. */
const MUSCLE_TO_TYPE: Record<string, ExerciseType> = {
  chest: "chest",
  lats: "back", "middle back": "back", "lower back": "back", traps: "back",
  shoulders: "shoulders", neck: "shoulders",
  biceps: "arms", triceps: "arms", forearms: "arms",
  quadriceps: "legs", hamstrings: "legs", calves: "legs", adductors: "legs", abductors: "legs",
  glutes: "glutes",
  abdominals: "core",
};

/** exercises.category values with no muscle of their own worth a picture. */
const CARDIO_CATEGORIES = new Set(["cardio", "plyometrics", "stretching"]);

/**
 * Type of one exercise. The cardio-like categories win over the muscle — the
 * library files "Rope Jumping" under quadriceps, and a skipping rope is not a
 * leg day; otherwise the first mapped primary muscle.
 */
export function exerciseTypeOf(muscles: readonly string[], category?: string | null): ExerciseType | null {
  if (category && CARDIO_CATEGORIES.has(category)) return "cardio";
  for (const m of muscles) {
    const type = MUSCLE_TO_TYPE[m];
    if (type) return type;
  }
  return null;
}

/**
 * Type of a training day. The groups the builder picked win when there are
 * any (program_days.muscle_groups, set by the solo builder); a coach-built day
 * has none, so its exercises vote instead. Ties go to whichever came first —
 * the builder's first pick, or the day's first exercise.
 */
export function dayTypeOf(
  muscleGroups: readonly string[],
  exercises: readonly { primary_muscles: readonly string[]; category: string | null }[],
): ExerciseType | null {
  const votes = new Map<ExerciseType, number>();
  const cast = (type: ExerciseType | null) => {
    if (type) votes.set(type, (votes.get(type) ?? 0) + 1);
  };
  if (muscleGroups.length > 0) muscleGroups.forEach((m) => cast(MUSCLE_TO_TYPE[m] ?? null));
  else exercises.forEach((e) => cast(exerciseTypeOf(e.primary_muscles, e.category)));

  let best: ExerciseType | null = null;
  let bestVotes = 0;
  for (const [type, n] of votes) {
    if (n > bestVotes) {
      best = type;
      bestVotes = n;
    }
  }
  return best;
}
