"use server";
import { filterExercises, type ExerciseFilter, type ExerciseSummary } from "@buddygym/shared";
import { isDemo, supabaseServer } from "@/lib/supabase/server";
import { exerciseLibrary } from "@/lib/exercise-library";

// Exercise search (W5), callable from client components.
//
// The library is 873 rows; none of it belongs in the browser bundle. The picker
// asks for a page of matches as the coach types and renders only those.
const PAGE_SIZE = 40;

export async function searchExerciseLibrary(
  filter: ExerciseFilter,
): Promise<{ results: ExerciseSummary[]; total: number }> {
  if (isDemo) {
    const matched = filterExercises(exerciseLibrary(), filter);
    return { results: matched.slice(0, PAGE_SIZE), total: matched.length };
  }

  const supabase = await supabaseServer();
  let query = supabase
    .from("exercises")
    .select(
      "id, external_id, name_en, name_ro, category, level, force, mechanic, equipment, primary_muscles, secondary_muscles, instructions_en, images",
      { count: "exact" },
    )
    .limit(PAGE_SIZE);

  if (filter.q?.trim()) {
    const safe = filter.q.replace(/[,()%\\]/g, " ").trim();
    query = query.or(`name_en.ilike.%${safe}%,name_ro.ilike.%${safe}%`);
  }
  if (filter.muscle) query = query.contains("primary_muscles", [filter.muscle]);
  if (filter.equipment) query = query.eq("equipment", filter.equipment);

  const { data, error, count } = await query;
  if (error) return { results: [], total: 0 };
  return { results: (data ?? []) as ExerciseSummary[], total: count ?? 0 };
}
