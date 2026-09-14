"use server";
import { revalidatePath } from "next/cache";
import { liveUser } from "@/lib/supabase/server";
import { mutated } from "@/lib/supabase/mutate";
import type { ActionResult } from "./actions";
import { notSignedIn } from "@/lib/action-result";

/**
 * Admin: give a shared food its Romanian name.
 *
 * The USDA import is English-only; this is how the gap closes, one row at a
 * time, from /admin/foods. RLS (`foods_admin_update`, migration 20260910120000)
 * is what restricts it to admins — the role check here only produces a clearer
 * message than PostgREST's silent zero-row update would.
 */
export async function setFoodRomanianName(foodId: string, nameRo: string): Promise<ActionResult> {
  const clean = nameRo.trim();
  if (clean.length > 120) return { ok: false, message: "Name too long" };


  const live = await liveUser();
  if (!live) return notSignedIn;
  const { supabase, userId } = live;
  const { data: me } = await supabase.from("users").select("role").eq("id", userId).maybeSingle();
  if (me?.role !== "admin") return { ok: false, message: "Admins only" };

  const result = await supabase
    .from("foods")
    // Empty input clears the translation, so a wrong one can be undone.
    .update({ name_ro: clean || null }, { count: "exact" })
    .eq("id", foodId);
  const failed = await mutated(result);
  if (failed) return failed;

  revalidatePath("/admin/foods");
  return { ok: true };
}
