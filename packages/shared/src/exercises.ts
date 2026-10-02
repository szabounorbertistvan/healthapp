import type { ExerciseVideoSource } from "./video";
// Exercise library (W5). One row shape for the whole app: it matches what
// import-exercises upserts into `exercises`, so the seed in
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
  /**
   * The demo this person sees — already resolved by pickExerciseVideo (their
   * own link, else their coach's, else the row's). Only YouTube — see
   * youtubeEmbedUrl().
   */
  video_url?: string | null;
  /** Which layer video_url came from; null when there is none. */
  video_source?: ExerciseVideoSource | null;
  /** True for a custom exercise the signed-in user created — theirs to rename. */
  mine?: boolean;
};

export type ExerciseFilter = {
  q?: string;
  muscle?: string;
  equipment?: string;
};

/**
 * A search box's text as the words every match must contain, each anywhere in
 * the name. "sit ups" has to find "Sit-Up": as one substring it never would
 * (the library hyphenates, and says "Up"), so the text is split on anything
 * that is not a letter or a digit and a plural "s" is dropped — "ups" → "up",
 * "lunges" → "lunge", but "press" stays "press". Dropping it only widens a
 * substring match, never narrows it. Accents are kept: the database's ilike
 * compares them as typed. At most five words; an empty list means no filter.
 */
export function exerciseSearchTerms(query: string | null | undefined): string[] {
  const words = (query ?? "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const terms = words.map((w) => (w.length >= 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
  return [...new Set(terms)].slice(0, 5);
}

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
  const terms = exerciseSearchTerms(filter.q);
  const muscle = filter.muscle ? normalizeForSearch(filter.muscle) : "";
  const equipment = filter.equipment ? normalizeForSearch(filter.equipment) : "";

  const matched = library.filter((e) => {
    if (terms.some((term) => !matchesQuery(`${e.name_en} ${e.name_ro ?? ""}`, term))) return false;
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
