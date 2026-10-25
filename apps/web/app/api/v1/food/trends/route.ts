import type { NutritionTrendsV1 } from "@healthapp/api/v1";
import {
  isLoggedDay, mealDistribution, nutritionInsights, nutritionProgress, nutritionSeries, progressWindows, shiftDays, sumMacros, weekNutrition,
  type ProgressRange,
} from "@healthapp/shared";
import { apiError, apiJson, v1Route } from "@/lib/api/v1";
import { getMyDayNutrition, getMyPlanMeals } from "@/lib/client-data";
import { isoDay } from "@/lib/dates";
import { getMyNutritionEntries, getMyNutritionTrends } from "@/lib/nutrition-data";

// Nutrition trends — the web's /food?view=trends (TrendsView): the same reads
// and the same packages/shared folds, so the phone and the page cannot
// disagree on a number. The label nutrients and adaptive targets stay on the web.
export const dynamic = "force-dynamic";

const RANGES: Record<string, ProgressRange> = { "7": 7, "30": 30, "90": 90, "365": 365, all: null };

export const GET = v1Route(async (request) => {
  const raw = new URL(request.url).searchParams.get("range") ?? "30";
  const range: ProgressRange = raw in RANGES ? RANGES[raw]! : 30;
  const [trends, nutrition, planMeals, detail] = await Promise.all([
    getMyNutritionTrends(range),
    getMyDayNutrition(),
    getMyPlanMeals(),
    getMyNutritionEntries(range === null ? null : shiftDays(isoDay(), -(2 * range))),
  ]);
  if (!trends) return apiError("unauthorized", 401);
  const target = nutrition.target.kcal > 0 ? nutrition.target : null;
  const windows = progressWindows(trends.today, range, trends.firstDay);
  const progress = nutritionProgress(trends.days, windows, target, { firstDay: trends.firstDay, today: trends.today });
  const plannedFoods = planMeals.flatMap((m) => m.foods.map((f) => f.macros));
  const covered = detail !== null && (detail.completeFrom === null || windows.current.start >= detail.completeFrom);
  return apiJson<NutritionTrendsV1>({
    range,
    today: { totals: nutrition.totals, target, meals: new Set(nutrition.entries.map((e) => e.slot)).size },
    progress,
    insights: nutritionInsights(progress),
    series: nutritionSeries(trends.days, windows.current),
    week: weekNutrition(trends.days, trends.today, target),
    plan: nutrition.plan_name && nutrition.plan_owner
      ? { name: nutrition.plan_name, owner: nutrition.plan_owner, planned_kcal: plannedFoods.length > 0 ? sumMacros(plannedFoods).kcal : null, planned_meals: planMeals.length }
      : null,
    truncated: trends.truncated,
    meals: covered ? mealDistribution(detail!.entries, windows.current) : null,
    days: trends.days.filter((d) => d.day >= windows.current.start && d.day <= windows.current.end && isLoggedDay(d)).reverse(),
    today_iso: trends.today,
  });
});
