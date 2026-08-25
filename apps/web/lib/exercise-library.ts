import { readFileSync } from "node:fs";
import path from "node:path";
import type { ExerciseSummary } from "@buddygym/shared";

// Server-only. The seed is the same 873 public-domain rows that
// supabase/functions/import-exercises writes into the `exercises` table, so the
// library looks identical before and after a database exists.
//
// Read once and cached: 995 KB of JSON should not be parsed per request, and it
// must never reach the client bundle — pass filtered slices to components.

let cache: ExerciseSummary[] | null = null;

const CANDIDATES = [
  path.resolve(process.cwd(), "../../supabase/seed/exercises.json"), // running from apps/web
  path.resolve(process.cwd(), "supabase/seed/exercises.json"), // running from the repo root
];

export function exerciseLibrary(): ExerciseSummary[] {
  if (cache) return cache;
  for (const candidate of CANDIDATES) {
    try {
      cache = JSON.parse(readFileSync(candidate, "utf8")) as ExerciseSummary[];
      return cache;
    } catch {
      // try the next location
    }
  }
  throw new Error(
    "Exercise seed not found. Expected supabase/seed/exercises.json — " +
      "regenerate it or run the import-exercises function against a live database.",
  );
}

/** Facet values actually present in the library, for the filter chips. */
export function exerciseFacets(): { muscles: string[]; equipment: string[] } {
  const library = exerciseLibrary();
  const muscles = new Set<string>();
  const equipment = new Set<string>();
  for (const exercise of library) {
    exercise.primary_muscles.forEach((m) => muscles.add(m));
    if (exercise.equipment) equipment.add(exercise.equipment);
  }
  return {
    muscles: [...muscles].sort(),
    equipment: [...equipment].sort(),
  };
}
