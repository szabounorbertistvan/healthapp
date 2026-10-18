"use server";
// Food diary writes. Planned meals and "same as yesterday" re-read the rows
// on the server; a derived client_generated_id makes a double tap a no-op.
import type { MealSlot } from "@/lib/types";
import { myToday } from "@/lib/my-today";
import { validDay } from "@/lib/week";
import { revalidatePath } from "next/cache";
import { id as uuidShape } from "@/lib/validate";
import {
  gramsFromSplit, isPlanLimitError, isValidPortionGrams, MACRO_KEYS, MAX_PORTION_GRAMS, portionMacros,
  type Macros, type MacroSplit,
} from "@healthapp/shared";
import { fill } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import { liveUser } from "@/lib/supabase/server";
import { uuidFrom } from "@/lib/stable-id";
import { getMyPlanMeals } from "@/lib/client-nutrition";
import type { ActionResult } from "./actions";
import { notSignedIn, planLimitReached } from "@/lib/action-result";



export async function logFood(input: {
  slot: MealSlot;
  foodName: string;
  grams: number;
  per100g: Macros;
  /** foods.id, so a later portion edit can re-cost from the unrounded basis. */
  foodId?: string | null;
  day?: string;
}): Promise<ActionResult> {
  if (!input.foodName.trim()) return { ok: false, message: "Pick a food" };
  if (!isValidPortionGrams(input.grams)) {
    return { ok: false, message: fill((await getI18n()).t.clientWidgets.foodLogger.gramsRange, { max: MAX_PORTION_GRAMS }) };
  }
  // The person's own calendar, not the server's: a meal at 00:30 in Bucharest is today's.
  const day = input.day ?? (await myToday());
  // Snapshot the macros now: the food row may change, this log must not.
  const macros = portionMacros(input.per100g, input.grams);


  const live = await liveUser();
  if (!live) return notSignedIn;
  const { supabase, userId } = live;
  const { error } = await supabase.from("food_logs").insert({
    user_id: userId,
    date: day,
    slot: input.slot,
    food_id: asUuid(input.foodId),
    food_name: input.foodName,
    grams: input.grams,
    kcal: macros.kcal,
    protein_g: macros.protein,
    carbs_g: macros.carbs,
    fat_g: macros.fat,
    client_generated_id: crypto.randomUUID(),
    client_ts: new Date().toISOString(),
  });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/food");
  revalidatePath("/today");
  return { ok: true };
}



/**
 * "Ate as planned" — log every food the coach put in this meal, in one tap.
 *
 * The plan is re-read on the server rather than posted from the browser: the
 * macros that land in food_logs must be the coach's numbers, not whatever a
 * client sent. client_generated_id is derived from (user, day, slot, position)
 * instead of being random, so the unique constraint turns a double tap — or a
 * retry on a flaky connection — into a no-op rather than a second dinner.
 */
export async function logPlannedMeal(slot: MealSlot, day?: string, mealId?: string): Promise<ActionResult> {
  if (mealId !== undefined && !uuidShape.safeParse(mealId).success) return { ok: false, errorCode: "INVALID_INPUT" };
  const date = day ?? (await myToday());
  const live = await liveUser();
  if (!live) return notSignedIn;
  const { supabase, userId } = live;

  // Resolved for the day being logged, so logging Saturday from the diary
  // writes Saturday's planned meal rather than today's.
  // The slot's own meal by default; an extra meal of the day (20261204100000)
  // by its id — it logs into its slot next to that meal, never instead of it.
  const meals = await getMyPlanMeals(date);
  const meal = mealId
    ? meals.find((m) => m.id === mealId && m.slot === slot)
    : meals.find((m) => m.slot === slot && !m.extra);
  if (!meal || meal.foods.length === 0) return { ok: false, message: "No planned meal for this slot" };

  const { error } = await supabase.from("food_logs").upsert(
    meal.foods.map((f, i) => ({
      user_id: userId,
      date,
      slot,
      food_id: asUuid(f.food_id),
      food_name: f.name,
      grams: f.grams,
      kcal: f.macros.kcal,
      protein_g: f.macros.protein,
      carbs_g: f.macros.carbs,
      fat_g: f.macros.fat,
      // the slot meal keeps its original key, so a tap from before extras existed still dedupes
      client_generated_id: uuidFrom(meal.extra ? `planned:${userId}:${date}:${meal.id}:${i}` : `planned:${userId}:${date}:${slot}:${i}`),
      client_ts: new Date().toISOString(),
    })),
    { onConflict: "client_generated_id", ignoreDuplicates: true },
  );
  if (error) return { ok: false, message: error.message };
  revalidatePath("/food");
  revalidatePath("/today");
  return { ok: true };
}



/**
 * "Same as yesterday" for one meal: every food logged in `slot` on `fromDay`,
 * logged again on `toDay` with the same grams and the same macro snapshot.
 * The rows are re-read on the server (RLS: only the caller's own), never
 * posted from the browser, and each copy's client_generated_id is derived
 * from the source row and the target day, so a double tap is a no-op rather
 * than a second breakfast.
 */
export async function copyMealFromDay(slot: MealSlot, fromDay: string, toDay: string): Promise<ActionResult> {
  const from = validDay(fromDay);
  const to = validDay(toDay);
  if (!from || !to || from === to) return { ok: false, errorCode: "INVALID_INPUT" };
  const live = await liveUser();
  if (!live) return notSignedIn;
  const { supabase, userId } = live;
  const { data, error: readError } = await supabase
    .from("food_logs")
    .select("id, food_id, food_name, grams, kcal, protein_g, carbs_g, fat_g")
    .eq("user_id", userId)
    .eq("date", from)
    .eq("slot", slot);
  if (readError) return { ok: false, message: readError.message };
  type Row = { id: string; food_id: string | null; food_name: string; grams: number; kcal: number; protein_g: number; carbs_g: number; fat_g: number };
  const rows = (data ?? []) as Row[];
  if (rows.length === 0) return { ok: false, message: "Nothing logged in that meal" };
  const { error } = await supabase.from("food_logs").upsert(
    rows.map((r) => ({
      user_id: userId,
      date: to,
      slot,
      food_id: r.food_id,
      food_name: r.food_name,
      grams: r.grams,
      kcal: r.kcal,
      protein_g: r.protein_g,
      carbs_g: r.carbs_g,
      fat_g: r.fat_g,
      client_generated_id: uuidFrom(`copy:${userId}:${r.id}:${to}`),
      client_ts: new Date().toISOString(),
    })),
    { onConflict: "client_generated_id", ignoreDuplicates: true },
  );
  if (error) return { ok: false, message: error.message };
  revalidatePath("/food");
  revalidatePath("/today");
  return { ok: true };
}



/**
 * Correct a portion that was logged wrong. Macros are re-derived from the
 * per-100g basis rather than scaled from the stored snapshot, so repeated
 * edits cannot accumulate rounding drift. The basis comes from the linked
 * `foods` row where there is one; recovering it from the snapshot is only the
 * fallback, because that snapshot is rounded (kcal to a whole number, macros to
 * 0.1 g) and a small portion divides that error back up by 100/grams.
 */
export async function updateFoodLog(id: string, grams: number): Promise<ActionResult> {
  if (!isValidPortionGrams(grams)) {
    return { ok: false, message: fill((await getI18n()).t.clientWidgets.foodLogger.gramsRange, { max: MAX_PORTION_GRAMS }) };
  }


  const live = await liveUser();
  if (!live) return notSignedIn;
  const { supabase } = live;
  const { data: row, error: readError } = await supabase
    .from("food_logs")
    .select("grams, kcal, protein_g, carbs_g, fat_g, food_id")
    .eq("id", id)
    .single();
  if (readError) return { ok: false, message: readError.message };

  let per100g: Macros | null = null;
  if (row.food_id) {
    const { data: food } = await supabase
      .from("foods")
      .select("kcal_100g, protein_100g, carbs_100g, fat_100g")
      .eq("id", row.food_id)
      .maybeSingle();
    if (food) {
      per100g = {
        kcal: Number(food.kcal_100g),
        protein: Number(food.protein_100g),
        carbs: Number(food.carbs_100g),
        fat: Number(food.fat_100g),
      };
    }
  }
  if (!per100g) {
    // Older rows (and custom entries) carry no food link — scale the snapshot
    // and accept the rounding it was already stored with.
    const factor = 100 / row.grams;
    per100g = {
      kcal: row.kcal * factor,
      protein: row.protein_g * factor,
      carbs: row.carbs_g * factor,
      fat: row.fat_g * factor,
    };
  }
  const macros = portionMacros(per100g, grams);

  const { error } = await supabase
    .from("food_logs")
    .update({
      grams,
      kcal: macros.kcal,
      protein_g: macros.protein,
      carbs_g: macros.carbs,
      fat_g: macros.fat,
    })
    .eq("id", id);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/food");
  revalidatePath("/today");
  return { ok: true };
}



export async function deleteFoodLog(id: string): Promise<ActionResult> {
  const live = await liveUser();
  if (!live) return notSignedIn;
  const { supabase } = live;
  const { error } = await supabase.from("food_logs").delete().eq("id", id);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/food");
  revalidatePath("/today");
  return { ok: true };
}



/** PostgREST wants null, not a barcode or any other non-uuid, in a uuid column. */
function asUuid(value: string | null | undefined): string | null {
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}




/**
 * The client's own daily targets: calories plus a protein/carbs/fat split.
 * Stored as a nutrition plan with coach_id null (policy nplans_solo_all), the
 * same shape a coach's plan has, so getMyDayNutrition reads both through one
 * path — and while a coach is active the coach's plan still wins (pickProgram).
 * Grams are derived in @healthapp/shared from the split, never typed twice.
 */
export async function setMyNutritionTargets(input: {
  kcal: number;
  split: MacroSplit;
}): Promise<ActionResult> {
  if (!Number.isFinite(input.kcal) || input.kcal < 500 || input.kcal > 10000) {
    return { ok: false, message: "Daily calories must be between 500 and 10000" };
  }
  const total = input.split.protein + input.split.carbs + input.split.fat;
  if (total !== 100 || MACRO_KEYS.some((k) => input.split[k] < 0)) {
    return { ok: false, message: "The macro split must add up to 100%" };
  }
  const grams = gramsFromSplit(input.kcal, input.split);
  const { t } = await getI18n();
  const name = t.clientApp.nutritionTargets.ownPlanName;


  const live = await liveUser();
  if (!live) return notSignedIn;
  const { supabase, userId } = live;
  const { data: existing } = await supabase
    .from("nutrition_plans")
    .select("id")
    .eq("client_id", userId)
    .is("coach_id", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const values = {
    kcal_target: grams.kcal,
    protein_target_g: grams.protein,
    carbs_target_g: grams.carbs,
    fat_target_g: grams.fat,
    status: "published" as const,
  };
  const { error } = existing
    ? await supabase.from("nutrition_plans").update(values).eq("id", existing.id)
    : await supabase
        .from("nutrition_plans")
        .insert({ ...values, coach_id: null, client_id: userId, name });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/food");
  revalidatePath("/today");
  return { ok: true };
}



/**
 * Star or un-star a food in the logger. Keyed by the foods row when there is
 * one and by name otherwise (a product straight from Open Food Facts may have
 * no row yet). The per-100 g basis is snapshotted so the favourite still logs
 * if the row goes away — same rule as food_logs.
 */
export async function toggleFavoriteFood(input: {
  foodId: string | null;
  foodName: string;
  per100g: Macros;
}): Promise<ActionResult & { favorite?: boolean }> {
  const name = input.foodName.trim();
  if (!name) return { ok: false, message: "Pick a food" };


  const live = await liveUser();
  if (!live) return notSignedIn;
  const { supabase, userId } = live;
  const foodId = asUuid(input.foodId);
  let existing = supabase.from("food_favorites").select("id").eq("user_id", userId);
  existing = foodId
    ? existing.eq("food_id", foodId)
    : existing.is("food_id", null).ilike("food_name", name.replace(/[%_\\]/g, "\\$&"));
  const { data: rows, error: readError } = await existing.limit(1);
  if (readError) return { ok: false, message: readError.message };
  const found = (rows ?? [])[0] as { id: string } | undefined;
  if (found) {
    const { error } = await supabase.from("food_favorites").delete().eq("id", found.id).eq("user_id", userId);
    if (error) return { ok: false, message: error.message };
    revalidatePath("/food");
    return { ok: true, favorite: false };
  }
  const { error } = await supabase.from("food_favorites").insert({
    user_id: userId,
    food_id: foodId,
    food_name: name,
    kcal_100g: input.per100g.kcal,
    protein_100g: input.per100g.protein,
    carbs_100g: input.per100g.carbs,
    fat_100g: input.per100g.fat,
  });
  // enforce_plan_limit('favorite_foods'): a star past the plan's cap.
  if (isPlanLimitError(error?.message)) return planLimitReached;
  if (error) return { ok: false, message: error.message };
  revalidatePath("/food");
  return { ok: true, favorite: true };
}
