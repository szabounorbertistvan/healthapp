import "server-only";
import type { CoachPlanV1 } from "@healthapp/api/v1";
import type { NutritionPlanDetail } from "@/lib/types";

// A nutrition plan on the /api/v1 contract — the coach's plan page and the
// person's own meal plan read the same shape.
export function planV1(plan: NutritionPlanDetail, canEdit: boolean | null, foodsAllowed: boolean, recipes: { id: string; title: string }[] = []): CoachPlanV1 {
  return {
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
      recipe_id: typeof m.recipe === "object" ? m.recipe.id : null,
      foods: m.foods.map((f) => ({ id: f.id, food_name: f.food_name, grams: f.grams, macros: f.macros })),
      totals: m.totals,
    })),
    days: plan.days,
    can_edit: canEdit,
    foods_allowed: foodsAllowed,
    recipes,
  };
}
