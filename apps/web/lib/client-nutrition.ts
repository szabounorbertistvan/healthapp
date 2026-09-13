// Client nutrition reads: today's log, the week strip, the published plan.
import "server-only";
import {
  pickProgram,
  portionMacros,
  sumMacros,
  type Macros,
  type SelectableProgram,
} from "@healthapp/shared";
import { isDemo, liveUser } from "./supabase/server";
import { demoHasActiveCoach, store } from "./demo-store";
import { viewingClientId } from "./view-mode";
import { activeCoachId } from "./client-training";
import {
  clientStore,
  foodLogsOn,
  isoDay,
  totalsOn,
} from "./demo-client-store";
import type { ClientDayNutrition, MealSlot } from "./types";

const ZERO: Macros = { kcal: 0, protein: 0, carbs: 0, fat: 0 };

export async function getMyDayNutrition(day = isoDay()): Promise<ClientDayNutrition> {
  if (isDemo) {
    const clientId = await viewingClientId();
    const s = store();
    // Same rule as the live branch: while a coach is active their plan wins,
    // otherwise the client's own targets apply.
    const plan = pickProgram(
      s.plans.filter((p) => p.client_id === clientId && p.status === "published"),
      demoHasActiveCoach(clientId),
    );
    const entries = foodLogsOn(clientId, day).map((f) => ({
      id: f.id,
      slot: f.slot,
      food_name: f.food_name,
      grams: f.grams,
      macros: f.macros,
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
      totals: totalsOn(clientId, day),
      entries,
    };
  }

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
  if (isDemo) {
    const clientId = await viewingClientId();
    const days = new Set<string>();
    for (const f of clientStore().foodLogs) {
      if (f.client_id === clientId && f.logged_on >= from && f.logged_on <= to) days.add(f.logged_on);
    }
    return [...days].sort();
  }

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
export async function getMyPlanMeals(): Promise<
  { id: string; slot: MealSlot; name: string; foods: { name: string; grams: number; macros: Macros }[] }[]
> {
  if (isDemo) {
    const clientId = await viewingClientId();
    const s = store();
    const plan = pickProgram(
      s.plans.filter((p) => p.client_id === clientId && p.status === "published"),
      demoHasActiveCoach(clientId),
    );
    if (!plan) return [];
    return [...plan.meals]
      .sort((a, b) => a.position - b.position)
      .map((m) => ({
        id: m.id,
        slot: m.slot,
        name: m.name,
        foods: m.foods.map((f) => ({
          name: f.food_name,
          grams: f.grams,
          macros: portionMacros(f.per_100g, f.grams),
        })),
      }));
  }
  const live = await liveUser();
  if (!live) return [];
  const { supabase, userId } = live;
  const [{ data: rows }, coachId] = await Promise.all([
    supabase
      .from("nutrition_plans")
      .select(`id, coach_id, updated_at, planned_meals(id, slot, name, position,
        planned_meal_foods(id, grams, food:foods(name_ro, name_en, kcal_100g, protein_100g, carbs_100g, fat_100g)))`)
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
    food: { name_ro: string | null; name_en: string; kcal_100g: number; protein_100g: number; carbs_100g: number; fat_100g: number } | null;
  };
  type MealJoin = { id: string; slot: MealSlot; name: string; position: number; planned_meal_foods: FoodJoin[] };
  return ((data.planned_meals as unknown as MealJoin[]) ?? [])
    .sort((a, b) => a.position - b.position)
    .map((m) => ({
      id: m.id,
      slot: m.slot,
      name: m.name,
      foods: m.planned_meal_foods.map((f) => ({
        name: f.food?.name_ro ?? f.food?.name_en ?? "—",
        grams: f.grams,
        macros: portionMacros(
          {
            kcal: f.food?.kcal_100g ?? 0,
            protein: f.food?.protein_100g ?? 0,
            carbs: f.food?.carbs_100g ?? 0,
            fat: f.food?.fat_100g ?? 0,
          },
          f.grams,
        ),
      })),
    }));
}
