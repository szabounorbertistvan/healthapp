"use server";
import { revalidatePath } from "next/cache";
import { liveUser } from "@/lib/supabase/server";
import { mutated } from "@/lib/supabase/mutate";
import type { ActionResult } from "./actions";
import { notSignedIn } from "@/lib/action-result";

/**
 * Admin: give a library exercise its Romanian name and instructions.
 *
 * The Free Exercise DB import is English-only; this is how the gap closes, one
 * row at a time, from /admin/exercises. RLS (`exercises_admin_update`,
 * migration 20260916100000) is what restricts it to admins — the role check
 * here only produces a clearer message than PostgREST's silent zero-row update.
 */
export async function setExerciseRomanian(
  exerciseId: string,
  nameRo: string,
  instructionsRo: string,
): Promise<ActionResult> {
  const name = nameRo.trim();
  const instructions = instructionsRo.trim();
  if (name.length > 160) return { ok: false, message: "Name too long" };
  if (instructions.length > 8000) return { ok: false, message: "Instructions too long" };

  const live = await liveUser();
  if (!live) return notSignedIn;
  const { supabase, userId } = live;
  const { data: me } = await supabase.from("users").select("role").eq("id", userId).maybeSingle();
  if (me?.role !== "admin") return { ok: false, message: "Admins only" };

  const result = await supabase
    .from("exercises")
    // Empty input clears the translation, so a wrong one can be undone.
    .update({ name_ro: name || null, instructions_ro: instructions || null }, { count: "exact" })
    .eq("id", exerciseId);
  const failed = await mutated(result);
  if (failed) return failed;

  revalidatePath("/admin/exercises/translate");
  return { ok: true };
}
