// Client nutrition reads: today's log, the week strip, the published plan.
import { isoDay } from "./dates";
import { portionsFor } from "./food-portions";
import "server-only";
import {
  isoWeekday,
  mealsForWeekday,
  pickProgram,
  portionMacros,
  sumMacros,
  type Macros,
  type SelectableProgram,
} from "@healthapp/shared";
import { liveUser } from "./supabase/server";
import { activeCoachId } from "./client-training";
import type { ClientDayNutrition, MealSlot, QuickFood, QuickFoods } from "./types";

const ZERO: Macros = { kcal: 0, protein: 0, carbs: 0, fat: 0 };

export async function getMyDayNutrition(day = isoDay()): Promise<ClientDayNutrition> {

  const live = await liveUser();
  if (!live) return { day, plan_name: null, plan_owner: null, target: ZERO, totals: ZERO, entries: [] };
  const { supabase, userId } = live;
  const [{ data: plans }, { data: logs }, coachId] = await Promise.all([
    supabase
      .from("nutrition_plans")
      .select("id, name, kcal_target, protein_target_g, carbs_target_g, fat_target_g, coach_id, updated_at")
      .eq("client_id", userId)
      .eq("status", "published"),
    supabase
      .from("food_logs")
      .select("id, slot, food_name, grams, kcal, protein_g, carbs_g, fat_g")
      .eq("user_id", userId)
      .eq("date", day),
    activeCoachId(userId),
  ]);
  const plan = pickProgram(
    (plans ?? []) as unknown as (SelectableProgram & Record<string, unknown>)[],
    coachId !== null,
  ) as { name: string; coach_id: string | null; kcal_target: number; protein_target_g: number;
         carbs_target_g: number; fat_target_g: number } | null;
  type LogRow = {
    id: string; slot: MealSlot; food_name: string; grams: number;
    kcal: number; protein_g: number; carbs_g: number; fat_g: number;
  };
  const entries = ((logs ?? []) as unknown as LogRow[]).map((l) => ({
    id: l.id,
    slot: l.slot,
    food_name: l.food_name,
    grams: l.grams,
    macros: { kcal: l.kcal, protein: l.protein_g, carbs: l.carbs_g, fat: l.fat_g },
  }));
  return {
    day,
    plan_name: plan?.name ?? null,
    plan_owner: plan ? (plan.coach_id === null ? "self" : "coach") : null,
    target: plan
      ? {
          kcal: plan.kcal_target,
          protein: plan.protein_target_g,
          carbs: plan.carbs_target_g,
          fat: plan.fat_target_g,
        }
      : ZERO,
    totals: sumMacros(entries.map((e) => e.macros)),
    entries,
  };
}

/**
 * Which days in [from, to] have at least one food log — what the week strip
 * marks as "logged", so a glance shows the gaps in the week.
 */
export async function getMyFoodDays(from: string, to: string): Promise<string[]> {

  const live = await liveUser();
  if (!live) return [];
  const { supabase, userId } = live;
  const { data } = await supabase
    .from("food_logs")
    .select("date")
    .eq("user_id", userId)
    .gte("date", from)
    .lte("date", to);
  const days = new Set<string>();
  for (const row of (data ?? []) as { date: string }[]) days.add(row.date);
  return [...days].sort();
}

/** The published plan as a template — what the coach wants eaten, per meal. */
/**
 * The plan for one day. `day` defaults to today because every caller but the
 * food diary wants today; the diary passes the date it is showing, so browsing
 * back to Saturday shows Saturday's plan rather than today's.
 */
export async function getMyPlanMeals(day?: string): Promise<
  {
    id: string;
    slot: MealSlot;
    name: string;
    /** `per100g` and `food_id` are what logPlannedMeal needs to write a food_log
        that can still be re-costed exactly when the portion is edited later. */
    foods: { food_id: string | null; name: string; grams: number; per100g: Macros; macros: Macros }[];
  }[]
> {
  const live = await liveUser();
  if (!live) return [];
  const { supabase, userId } = live;
  const [{ data: rows }, coachId] = await Promise.all([
    supabase
      .from("nutrition_plans")
      .select(`id, coach_id, updated_at, planned_meals(id, slot, name, position, day_index,
        planned_meal_foods(id, grams, food:foods(id, name_ro, name_en, kcal_100g, protein_100g, carbs_100g, fat_100g)))`)
      .eq("client_id", userId)
      .eq("status", "published"),
    activeCoachId(userId),
  ]);
  const data = pickProgram(
    (rows ?? []) as unknown as (SelectableProgram & Record<string, unknown>)[],
    coachId !== null,
  );
  if (!data) return [];
  type FoodJoin = {
    grams: number;
    food: { id: string; name_ro: string | null; name_en: string; kcal_100g: number; protein_100g: number; carbs_100g: number; fat_100g: number } | null;
  };
  type MealJoin = {
    id: string; slot: MealSlot; name: string; position: number; day_index: number;
    planned_meal_foods: FoodJoin[];
  };
  // day_index has meant "0 = every day, 1..7 = that weekday" since the first
  // nutrition migration; until now nothing read it, so Monday and Sunday showed
  // the same food. mealsForWeekday resolves it the same way everywhere.
  return mealsForWeekday(
    (data.planned_meals as unknown as MealJoin[]) ?? [],
    isoWeekday(day ?? isoDay()),
  )
    .map((m) => ({
      id: m.id,
      slot: m.slot,
      name: m.name,
      foods: m.planned_meal_foods.map((f) => {
        const per100g = {
          kcal: f.food?.kcal_100g ?? 0,
          protein: f.food?.protein_100g ?? 0,
          carbs: f.food?.carbs_100g ?? 0,
          fat: f.food?.fat_100g ?? 0,
        };
        return {
          food_id: f.food?.id ?? null,
          name: f.food?.name_ro ?? f.food?.name_en ?? "—",
          grams: f.grams,
          per100g,
          macros: portionMacros(per100g, f.grams),
        };
      }),
    }));
}

/** What the star toggles on: the foods row when there is one, else the name. */
function quickKey(foodId: string | null, name: string): string {
  return foodId || `name:${name.trim().toLowerCase()}`;
}

/**
 * The logger's shortcuts: foods starred by the client, and the last few
 * distinct foods they logged (newest first, each with the grams of that log).
 * Recent excludes nothing — the picker hides the overlap itself so a starred
 * food shows once.
 */
export async function getMyQuickFoods(limit = 8): Promise<QuickFoods> {

  const live = await liveUser();
  if (!live) return { recent: [], favorites: [] };
  const { supabase, userId } = live;
  type FoodJoin = { kcal_100g: number; protein_100g: number; carbs_100g: number; fat_100g: number; portions: unknown } | null;
  type FavRow = { food_id: string | null; food_name: string; kcal_100g: number; protein_100g: number; carbs_100g: number; fat_100g: number; food: FoodJoin };
  type LogRow = { food_id: string | null; food_name: string; grams: number; kcal: number; protein_g: number; carbs_g: number; fat_g: number; food: FoodJoin };
  const [{ data: favData }, { data: logData }] = await Promise.all([
    supabase
      .from("food_favorites")
      .select("food_id, food_name, kcal_100g, protein_100g, carbs_100g, fat_100g, food:foods(kcal_100g, protein_100g, carbs_100g, fat_100g, portions)")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
    supabase
      .from("food_logs")
      .select("food_id, food_name, grams, kcal, protein_g, carbs_g, fat_g, food:foods(kcal_100g, protein_100g, carbs_100g, fat_100g, portions)")
      .eq("user_id", userId)
      .order("date", { ascending: false })
      .order("received_at", { ascending: false })
      .limit(60),
  ]);
  const favRows = (favData ?? []) as unknown as FavRow[];
  const logRows = (logData ?? []) as unknown as LogRow[];
  const portionsOf = (food: FoodJoin) =>
    Array.isArray(food?.portions) ? (food.portions as QuickFood["portions"]) : undefined;
  const basisOf = (food: FoodJoin, fallback: Macros): Macros =>
    food ? { kcal: food.kcal_100g, protein: food.protein_100g, carbs: food.carbs_100g, fat: food.fat_100g } : fallback;
  const favKeys = new Set(favRows.map((f) => quickKey(f.food_id, f.food_name)));
  const lastGrams = new Map<string, number>();
  for (const l of logRows) {
    const key = quickKey(l.food_id, l.food_name);
    if (!lastGrams.has(key)) lastGrams.set(key, l.grams);
  }

  const recent: QuickFood[] = [];
  const seen = new Set<string>();
  for (const l of logRows) {
    const key = quickKey(l.food_id, l.food_name);
    if (seen.has(key)) continue;
    seen.add(key);
    recent.push({
      food_id: l.food_id,
      name: l.food_name,
      // The linked row is the unrounded basis; the snapshot is the fallback for
      // a log whose food is gone (stored to 0.1, so close rather than exact).
      per_100g: basisOf(l.food, {
        kcal: (l.kcal * 100) / l.grams,
        protein: (l.protein_g * 100) / l.grams,
        carbs: (l.carbs_g * 100) / l.grams,
        fat: (l.fat_g * 100) / l.grams,
      }),
      portions: portionsOf(l.food),
      last_grams: l.grams,
      favorite: favKeys.has(key),
      group: null,
    });
    if (recent.length >= limit) break;
  }
  const favorites: QuickFood[] = favRows.map((f) => ({
    food_id: f.food_id,
    name: f.food_name,
    per_100g: basisOf(f.food, { kcal: f.kcal_100g, protein: f.protein_100g, carbs: f.carbs_100g, fat: f.fat_100g }),
    portions: portionsOf(f.food),
    last_grams: lastGrams.get(quickKey(f.food_id, f.food_name)) ?? null,
    favorite: true,
    group: null,
  }));
  return { recent, favorites };
}
