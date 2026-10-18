"use server";
// Writes for "My recipes": save a DishFinder hand-off as the person adjusted it,
// drop a pending hand-off, log servings into the diary, delete a recipe.
//
// The numbers saved are always worked out here, never taken from the browser:
// "from DishFinder" is the signed hand-off (re-verified from the cookie),
// "recalculated in Voinic" is the matched foods' per-100 g values read through
// foods_by_ids(). The browser only says which foods, how many grams, which
// lines, how many servings and how heavy one is.
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkRecipeSteps, recomputedServing, RECIPE_MAX_STEP_LENGTH, RECIPE_MAX_STEPS, scaledServing, type DialogLine, type Macros } from "@healthapp/shared";
import { notSignedIn } from "@/lib/action-result";
import { liveUser } from "@/lib/supabase/server";
import { mutated } from "@/lib/supabase/mutate";
import { myToday } from "@/lib/my-today";
import { validDay } from "@/lib/week";
import { id, parseInput, text } from "@/lib/validate";
import { HANDOFF_COOKIE, verifyHandoffCookie } from "@/lib/recipe-handoff-server";
import type { ActionResult } from "./actions";

function touched() {
  revalidatePath("/recipes");
  revalidatePath("/food");
  revalidatePath("/today");
}

const Line = z.object({
  position: z.number().int().min(0).max(59),
  foodId: id.nullable(),
  grams: z.number().positive().max(20000).nullable(),
  include: z.boolean(),
});
const SaveInput = z.object({
  title: text(160).min(1),
  servings: z.number().positive().max(500),
  servingGrams: z.number().positive().max(3000),
  /** true = recompute from the matched foods; false = DishFinder's numbers, scaled to the serving count. */
  recompute: z.boolean(),
  /** null = a new recipe; an id = overwrite that saved copy of the same DishFinder recipe. */
  replaceId: id.nullable(),
  lines: z.array(Line).max(60),
});

export async function saveRecipeImport(input: z.input<typeof SaveInput>): Promise<ActionResult & { id?: string }> {
  const parsed = await parseInput(SaveInput, input);
  if (!parsed.ok) return parsed.result;
  const v = parsed.data;
  const jar = await cookies();
  const pending = verifyHandoffCookie(jar.get(HANDOFF_COOKIE)?.value);
  if (!pending.ok) return { ok: false, errorCode: "INVALID_INPUT", message: pending.error };
  const r = pending.handoff.recipe;
  if (v.lines.some((l) => l.position >= r.ingredients.length)) return { ok: false, errorCode: "INVALID_INPUT" };

  const live = await liveUser();
  if (!live) return notSignedIn;
  const { supabase, userId } = live;

  // per-100 g of the chosen foods, read here — never posted by the browser
  const foodIds = [...new Set(v.lines.map((l) => l.foodId).filter((x): x is string => x !== null))];
  const per100 = new Map<string, Macros>();
  if (foodIds.length > 0) {
    const { data, error } = await supabase.rpc("foods_by_ids", { p_ids: foodIds });
    if (error) return { ok: false, message: error.message };
    for (const f of (data ?? []) as { id: string; kcal_100g: number; protein_100g: number; carbs_100g: number; fat_100g: number }[]) {
      per100.set(f.id, { kcal: Number(f.kcal_100g), protein: Number(f.protein_100g), carbs: Number(f.carbs_100g), fat: Number(f.fat_100g) });
    }
  }
  const byPos = new Map(v.lines.map((l) => [l.position, l]));
  const dialogLines: DialogLine[] = r.ingredients.map((_, i) => {
    const l = byPos.get(i);
    const food = l?.foodId && per100.has(l.foodId) ? { id: l.foodId, per100: per100.get(l.foodId)! } : null;
    return { food, grams: l?.grams ?? null, include: l ? l.include : true };
  });
  const serving = v.recompute
    ? recomputedServing(dialogLines, v.servings).macros
    : scaledServing(r.per_serving, r.servings, v.servings);

  const row = {
    owner_id: userId,
    title: v.title.trim(),
    servings: v.servings,
    serving_grams: Math.round(v.servingGrams * 10) / 10,
    kcal_serving: serving.kcal,
    protein_serving: serving.protein,
    carbs_serving: serving.carbs,
    fat_serving: serving.fat,
    nutrition_source: v.recompute ? "voinic" : "dishfinder",
    dishfinder_recipe_id: r.id,
    dishfinder_url: r.url,
    image_url: r.image,
  };

  let recipeId: string;
  if (v.replaceId) {
    const res = await supabase.from("recipes").update(row, { count: "exact" })
      .eq("id", v.replaceId).eq("owner_id", userId).eq("dishfinder_recipe_id", r.id).select("id");
    const failed = await mutated(res);
    if (failed) return failed;
    recipeId = v.replaceId;
    const del = await supabase.from("recipe_ingredients").delete().eq("recipe_id", recipeId);
    if (del.error) return { ok: false, message: del.error.message };
  } else {
    const { data, error } = await supabase.from("recipes").insert(row).select("id").single();
    if (error) return { ok: false, message: error.message.includes("RECIPE_LIMIT") ? "RECIPE_LIMIT" : error.message };
    recipeId = (data as { id: string }).id;
  }

  const lineRows = r.ingredients
    .map((ing, i) => ({ ing, l: dialogLines[i]! }))
    .filter(({ l }) => l.include)
    .map(({ ing, l }, n) => ({
      recipe_id: recipeId,
      position: n,
      label: (ing.qty ? `${ing.qty} ${ing.name}` : ing.name).slice(0, 200),
      food_id: l.food?.id ?? null,
      grams: l.grams,
      dishfinder_ingredient_id: ing.df_id,
    }));
  if (lineRows.length > 0) {
    const { error } = await supabase.from("recipe_ingredients").insert(lineRows);
    if (error) return { ok: false, message: error.message };
  }

  jar.delete(HANDOFF_COOKIE);
  touched();
  return { ok: true, id: recipeId };
}

/** "Not now": the pending hand-off is dropped; nothing was saved. */
export async function cancelRecipeImport(): Promise<ActionResult> {
  (await cookies()).delete(HANDOFF_COOKIE);
  revalidatePath("/recipes");
  return { ok: true };
}

const LogInput = z.object({
  recipeId: id,
  servings: z.number().positive().max(20),
  slot: z.enum(["breakfast", "lunch", "dinner", "snack"]),
  day: z.string().max(10).nullable(),
});

/**
 * n servings of a saved recipe into the diary: n × the serving's grams and
 * macros, snapshotted like every food_log (a later edit of the recipe does not
 * rewrite what was eaten).
 */
export async function logRecipeServings(input: z.input<typeof LogInput>): Promise<ActionResult> {
  const parsed = await parseInput(LogInput, input);
  if (!parsed.ok) return parsed.result;
  const v = parsed.data;
  const day = v.day ? validDay(v.day) : await myToday();
  if (!day) return { ok: false, errorCode: "INVALID_INPUT" };
  const live = await liveUser();
  if (!live) return notSignedIn;
  const { supabase, userId } = live;
  const { data: recipe } = await supabase
    .from("recipes")
    .select("title, serving_grams, kcal_serving, protein_serving, carbs_serving, fat_serving")
    .eq("id", v.recipeId).eq("owner_id", userId).maybeSingle();
  if (!recipe) return { ok: false, errorCode: "NO_ROWS" };
  const k = v.servings;
  const r1 = (x: number) => Math.round(Number(x) * k * 10) / 10;
  const { error } = await supabase.from("food_logs").insert({
    user_id: userId,
    date: day,
    slot: v.slot,
    food_id: null,
    food_name: recipe.title,
    grams: r1(recipe.serving_grams),
    kcal: r1(recipe.kcal_serving),
    protein_g: r1(recipe.protein_serving),
    carbs_g: r1(recipe.carbs_serving),
    fat_g: r1(recipe.fat_serving),
    method: "recipe",
    client_generated_id: crypto.randomUUID(),
    client_ts: new Date().toISOString(),
  });
  if (error) return { ok: false, message: error.message };
  touched();
  return { ok: true };
}

export async function deleteRecipe(recipeId: string): Promise<ActionResult> {
  const parsed = await parseInput(id, recipeId);
  if (!parsed.ok) return parsed.result;
  const live = await liveUser();
  if (!live) return notSignedIn;
  const res = await live.supabase.from("recipes").delete({ count: "exact" }).eq("id", parsed.data).eq("owner_id", live.userId);
  const failed = await mutated(res);
  if (failed) return failed;
  touched();
  return { ok: true };
}

const PrepInput = z.object({
  recipeId: id,
  /** In order; blank lines already dropped by recipeStepsFromText. An empty list clears the instructions. */
  steps: z.array(z.string().max(RECIPE_MAX_STEP_LENGTH)).max(RECIPE_MAX_STEPS),
  prepMinutes: z.number().int().min(0).max(1440).nullable(),
  cookMinutes: z.number().int().min(0).max(1440).nullable(),
});

/**
 * The owner's preparation steps and times for one recipe (20261203100000).
 * Only those three columns are written: servings, grams and macros — what the
 * diary and any logged serving rely on — are not part of this update.
 */
export async function updateRecipePreparation(input: z.input<typeof PrepInput>): Promise<ActionResult> {
  const parsed = await parseInput(PrepInput, input);
  if (!parsed.ok) return parsed.result;
  const v = parsed.data;
  const steps = v.steps.map((s) => s.trim()).filter((s) => s.length > 0);
  if (checkRecipeSteps(steps) !== "ok") return { ok: false, errorCode: "INVALID_INPUT" };
  const live = await liveUser();
  if (!live) return notSignedIn;
  const res = await live.supabase
    .from("recipes")
    .update({ steps, prep_minutes: v.prepMinutes, cook_minutes: v.cookMinutes }, { count: "exact" })
    .eq("id", v.recipeId)
    .eq("owner_id", live.userId);
  const failed = await mutated(res);
  if (failed) return failed;
  revalidatePath("/recipes");
  return { ok: true };
}
