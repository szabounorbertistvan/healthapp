"use server";
import { filterExercises, type ExerciseFilter, type ExerciseSummary } from "@healthapp/shared";
import { liveUser, supabaseServer } from "@/lib/supabase/server";
import { exerciseLibrary } from "@/lib/exercise-library";
import { notSignedIn } from "@/lib/action-result";
import { mutated } from "@/lib/supabase/mutate";
import { revalidatePath } from "next/cache";
import type { ActionResult } from "./actions";

// Exercise search (W5), callable from client components.
//
// The library is 873 rows; none of it belongs in the browser bundle. The picker
// asks for a page of matches as the coach types and renders only those; `offset`
// fetches the next page when they scroll past the first. (Not exported: a
// "use server" module may only export async functions.)
const EXERCISE_PAGE_SIZE = 40;

export async function searchExerciseLibrary(
  filter: ExerciseFilter,
  offset = 0,
): Promise<{ results: ExerciseSummary[]; total: number }> {

  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  let query = supabase
    .from("exercises")
    .select(
      "id, external_id, name_en, name_ro, category, level, force, mechanic, equipment, primary_muscles, secondary_muscles, instructions_en, images, owner_id",
      { count: "exact" },
    )
    // Without an order, Postgres hands back whichever 40 rows it reaches first —
    // a different set on every request, and never "the whole list".
    .order("name_en")
    .range(offset, offset + EXERCISE_PAGE_SIZE - 1);

  if (filter.q?.trim()) {
    const safe = filter.q.replace(/[,()%\\]/g, " ").trim();
    query = query.or(`name_en.ilike.%${safe}%,name_ro.ilike.%${safe}%`);
  }
  if (filter.muscle) query = query.contains("primary_muscles", [filter.muscle]);
  if (filter.equipment) query = query.eq("equipment", filter.equipment);

  const { data, error, count } = await query;
  if (error) return { results: [], total: 0 };
  type Row = ExerciseSummary & { owner_id: string | null };
  const results = ((data ?? []) as Row[]).map(({ owner_id, ...e }) => ({ ...e, mine: owner_id !== null && owner_id === auth.user?.id }));
  return { results, total: count ?? 0 };
}

export type NewExerciseInput = {
  name: string;
  primaryMuscle: string;
  secondaryMuscles?: string[];
  equipment?: string | null;
  category?: string | null;
  level?: string | null;
  mechanic?: string | null;
  force?: string | null;
  instructions?: string | null;
};

/**
 * Create a custom exercise. The row lands in `exercises` with owner_id set and
 * source 'custom' (policy exercises_owner_write requires exactly that), so it
 * is private to whoever made it while the system library stays shared. Both a
 * coach in the program builder and a solo client in theirs can call this.
 * Returns the created row so the picker can add it to the day straight away.
 */
export async function createCustomExercise(
  input: NewExerciseInput,
): Promise<{ ok: true; exercise: ExerciseSummary } | { ok: false; message: string }> {
  const name = input.name.trim();
  if (name.length < 2) return { ok: false, message: "Give the exercise a name" };
  if (!input.primaryMuscle) return { ok: false, message: "Pick the main muscle it trains" };
  const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
  const secondary = (input.secondaryMuscles ?? []).filter((m) => m && m !== input.primaryMuscle);


  const live = await liveUser();
  if (!live) return notSignedIn;
  const { supabase, userId } = live;
  const { data, error } = await supabase
    .from("exercises")
    .insert({
      owner_id: userId,
      source: "custom",
      name_en: name,
      name_ro: name,
      category: clean(input.category),
      level: clean(input.level),
      force: clean(input.force),
      mechanic: clean(input.mechanic),
      equipment: clean(input.equipment),
      primary_muscles: [input.primaryMuscle],
      secondary_muscles: secondary,
      instructions_en: clean(input.instructions),
    })
    .select(
      "id, external_id, name_en, name_ro, category, level, force, mechanic, equipment, primary_muscles, secondary_muscles, instructions_en, images",
    )
    .single();
  if (error) return { ok: false, message: error.message };
  const row = data as unknown as ExerciseSummary & { external_id: string | null };
  return {
    ok: true,
    exercise: { ...row, external_id: row.external_id ?? row.id ?? name, instructions_en: row.instructions_en ?? "" },
  };
}

/**
 * Rename a custom exercise. Only its owner can (policy exercises_owner_update,
 * and the .eq on owner_id here); a system-library row has no owner, so a
 * client can never rename "Bench Press" for everyone. Programs reference the
 * row by id and pick the name up; logged sets reference it by id too, so the
 * history shows the new name — the lift itself is unchanged.
 */
export async function renameExercise(exerciseId: string, name: string): Promise<ActionResult> {
  const clean = name.trim();
  if (clean.length < 2) return { ok: false, message: "Give the exercise a name" };
  const live = await liveUser();
  if (!live) return notSignedIn;
  const { supabase, userId } = live;
  const failed = await mutated(
    await supabase
      .from("exercises")
      .update({ name_en: clean, name_ro: clean }, { count: "exact" })
      .eq("id", exerciseId)
      .eq("owner_id", userId)
      .eq("source", "custom"),
  );
  if (failed) return failed;
  revalidatePath("/library");
  revalidatePath("/exercises");
  revalidatePath("/workout", "layout");
  revalidatePath("/programs", "layout");
  return { ok: true };
}
