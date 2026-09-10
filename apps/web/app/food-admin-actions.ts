"use server";
import { revalidatePath } from "next/cache";
import { isDemo, supabaseServer } from "@/lib/supabase/server";
import { mutated } from "@/lib/supabase/mutate";
import { demoFoods } from "@/lib/demo-foods";
import type { ActionResult } from "./actions";

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

  if (isDemo) {
    const food = demoFoods.find((f) => f.id === foodId);
    if (!food) return { ok: false, message: "Food not found" };
    food.name_ro = clean || food.name_en;
    revalidatePath("/admin/foods");
    return { ok: true, demo: true };
  }

  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, message: "Not signed in" };
  const { data: me } = await supabase.from("users").select("role").eq("id", auth.user.id).maybeSingle();
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
