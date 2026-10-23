import type { FoodDayV1, QuickFoodV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { getMyDayNutrition, getMyPlanMeals, getMyQuickFoods } from "@/lib/client-data";
import { myToday } from "@/lib/my-today";
import type { QuickFood } from "@/lib/types";
import { validDay } from "@/lib/week";

// The app's food diary for one day (?day=YYYY-MM-DD, default the person's today):
// what /food renders — the same targets, totals, entries and planned meals.
export const dynamic = "force-dynamic";

export const GET = v1Route(async (request) => {
  const asked = new URL(request.url).searchParams.get("day");
  const today = await myToday();
  const day = asked && validDay(asked) ? asked : today;
  const [nutrition, meals, quick] = await Promise.all([getMyDayNutrition(day), getMyPlanMeals(day), getMyQuickFoods()]);
  const quickFood = (q: QuickFood): QuickFoodV1 => ({
    food_id: q.food_id, name: q.name, per_100g: q.per_100g, portions: q.portions ?? [], last_grams: q.last_grams, favorite: q.favorite,
  });
  return apiJson<FoodDayV1>({
    day: nutrition.day,
    today,
    plan_name: nutrition.plan_name,
    plan_owner: nutrition.plan_owner,
    target: nutrition.target,
    totals: nutrition.totals,
    entries: nutrition.entries.map((e) => ({ id: e.id, slot: e.slot, food_name: e.food_name, grams: e.grams, macros: e.macros })),
    planned: meals.map((m) => ({
      id: m.id, slot: m.slot, name: m.name, extra: m.extra,
      foods: m.foods.map((f) => ({ name: f.name, grams: f.grams, macros: f.macros })),
    })),
    quick: { recent: quick.recent.map(quickFood), favorites: quick.favorites.map(quickFood) },
  });
});
