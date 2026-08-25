// Exercise library (W5). One row shape for the whole app: it matches what
// import-exercises upserts into `exercises`, so the demo seed in
// supabase/seed/exercises.json and a live database are interchangeable.

import { matchesQuery, normalizeForSearch } from "./text";

export type ExerciseSummary = {
  /** Database primary key. Absent in the JSON seed, which has no uuids yet. */
  id?: string;
  external_id: string;
  name_en: string;
  name_ro: string | null;
  category: string | null;
  level: string | null;
  force: string | null;
  mechanic: string | null;
  equipment: string | null;
  primary_muscles: string[];
  secondary_muscles: string[];
  instructions_en: string;
  images: string[];
};

export type ExerciseFilter = {
  q?: string;
  muscle?: string;
  equipment?: string;
};

/**
 * Free-text over both names, plus muscle and equipment facets. A muscle match
 * counts whether the exercise trains it directly or as a helper — a coach
 * looking for "biceps" wants chin-ups in the list — but direct matches sort
 * first, because that is what they usually mean.
 */
export function filterExercises(
  library: readonly ExerciseSummary[],
  filter: ExerciseFilter,
): ExerciseSummary[] {
  const q = filter.q?.trim();
  const muscle = filter.muscle ? normalizeForSearch(filter.muscle) : "";
  const equipment = filter.equipment ? normalizeForSearch(filter.equipment) : "";

  const matched = library.filter((e) => {
    if (q && !matchesQuery(`${e.name_en} ${e.name_ro ?? ""}`, q)) return false;
    if (equipment && normalizeForSearch(e.equipment ?? "") !== equipment) return false;
    if (muscle && musclePriority(e, muscle) === 0) return false;
    return true;
  });

  if (!muscle) return matched;
  return matched.sort((a, b) => musclePriority(b, muscle) - musclePriority(a, muscle));
}

/** 2 = trains it directly, 1 = as a secondary muscle, 0 = not at all. */
function musclePriority(exercise: ExerciseSummary, muscle: string): number {
  if (exercise.primary_muscles.some((m) => normalizeForSearch(m) === muscle)) return 2;
  if (exercise.secondary_muscles.some((m) => normalizeForSearch(m) === muscle)) return 1;
  return 0;
}

/** What program_exercises.exercise_id must point at: the row id once a database exists. */
export function exerciseRef(exercise: ExerciseSummary): string {
  return exercise.id ?? exercise.external_id;
}

export function exerciseName(exercise: ExerciseSummary, locale: "ro" | "en" = "ro"): string {
  return (locale === "ro" ? exercise.name_ro : null) ?? exercise.name_en;
}
