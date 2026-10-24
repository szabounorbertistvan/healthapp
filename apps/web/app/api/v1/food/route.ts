import type { FoodDayV1, QuickFoodV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { getMyDayNutrition, getMyFoodDays, getMyPlanMeals, getMyQuickFoods } from "@/lib/client-data";
import { myToday } from "@/lib/my-today";
import type { QuickFood } from "@/lib/types";
import { shiftDay, validDay, weekDaysOf } from "@/lib/week";

// The app's food diary for one day (?day=YYYY-MM-DD, default the person's today):
// what /food renders — the same targets, totals, entries and planned meals, the
// week strip's logged days and the day before for "same as yesterday".
export const dynamic = "force-dynamic";

export const GET = v1Route(async (request) => {
  const asked = new URL(request.url).searchParams.get("day");
  const today = await myToday();
  const day = asked && validDay(asked) ? asked : today;
  const week = weekDaysOf(day);
  const dayBefore = shiftDay(day, -1);
  const [nutrition, meals, quick, loggedDays, before] = await Promise.all([
    getMyDayNutrition(day), getMyPlanMeals(day), getMyQuickFoods(), getMyFoodDays(week[0]!, week[6]!), getMyDayNutrition(dayBefore),
  ]);
  const previous: NonNullable<FoodDayV1["previous_day"]>["slots"] = {};
  for (const e of before.entries) {
    const slot = (previous[e.slot] ??= { items: 0, kcal: 0 });
    slot.items += 1;
    slot.kcal += e.macros.kcal;
  }
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
    logged_days: loggedDays,
    previous_day: { day: dayBefore, slots: previous },
  });
});
