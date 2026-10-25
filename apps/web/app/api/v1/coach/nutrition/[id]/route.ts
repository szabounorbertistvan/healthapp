import type { CoachPlanV1 } from "@healthapp/api/v1";
import { apiError, apiJson, v1Route } from "@/lib/api/v1";
import { canEdit } from "@/lib/can-edit";
import { getNutritionPlan } from "@/lib/data";
import { getPlan } from "@/lib/plan";

// One of the coach's nutrition plans — the web's /nutrition/[id]: targets, the
// meals (every day and per weekday) with their foods and grams, what each day
// adds up to, and whether it can still be edited (can_edit_nutrition_plan).
export const dynamic = "force-dynamic";

export const GET = v1Route(async (request) => {
  const id = decodeURIComponent(new URL(request.url).pathname.split("/").at(-1) ?? "");
  const [plan, access, tier] = await Promise.all([getNutritionPlan(id), canEdit("can_edit_nutrition_plan", { p_plan: id }), getPlan()]);
  if (!plan) return apiError("not_found", 404);
  return apiJson<CoachPlanV1>({
    id: plan.id,
    name: plan.name,
    client_name: plan.client_name,
    status: plan.status,
    target: { kcal: plan.kcal_target, protein: plan.protein_target_g, carbs: plan.carbs_target_g, fat: plan.fat_target_g },
    meals: plan.meals.map((m) => ({
      id: m.id,
      slot: m.slot,
      name: m.name,
      day_index: m.day_index,
      extra: m.extra,
      recipe_title: typeof m.recipe === "object" ? m.recipe.title : null,
      foods: m.foods.map((f) => ({ id: f.id, food_name: f.food_name, grams: f.grams, macros: f.macros })),
      totals: m.totals,
    })),
    days: plan.days,
    can_edit: access === "edit" ? true : access === "read-only" ? false : null,
    foods_allowed: tier.e.ingredientPlans,
  });
});
