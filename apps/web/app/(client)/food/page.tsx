import { getMyDayNutrition, getMyFoodDays, getMyPlanMeals, getMyQuickFoods } from "@/lib/client-data";
import { validDay, weekDaysOf } from "@/lib/week";
import { getI18n } from "@/lib/i18n/server";
import { WeekStrip } from "@/components/week-strip";
import { NutritionSummary } from "@/components/nutrition-summary";
import { MealCard } from "@/components/meal-card";
import type { MealSlot } from "@/lib/types";
import { isoDay } from "@/lib/dates";
import { getPlan, inHistory } from "@/lib/plan";
import { UpgradeHint } from "@/components/upgrade";
import { FoodViewTabs, NutritionTrends } from "@/components/nutrition-trends";
import { EmptyState } from "@/components/ui";
import { getMyNutritionTrends } from "@/lib/nutrition-data";
import { parseFoodParams, type FoodState } from "@/lib/nutrition-params";
import {
  nutritionInsights,
  nutritionProgress,
  nutritionSeries,
  progressWindows,
  sumMacros,
  weekNutrition,
} from "@healthapp/shared";

const SLOTS: MealSlot[] = ["breakfast", "lunch", "dinner", "snack"];

/**
 * The food diary for one day. `?day=yyyy-mm-dd` picks the day (today when
 * absent or malformed), so the week strip is plain links and back/forward
 * work. Layout: week strip across the top → the day's summary (goal, consumed,
 * what is left, macro rings) → one card per meal with "add foods" inside it.
 *
 * `?view=trends` swaps the diary for the trends view (TrendsView below); the
 * Diary | Trends switch sits above both.
 */
export default async function FoodPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const state = parseFoodParams(params);
  if (state.view === "trends") return <TrendsView state={state} />;

  const { t } = await getI18n();
  const today = isoDay();
  const day = validDay(typeof params.day === "string" ? params.day : undefined) ?? today;
  const week = weekDaysOf(day);
  const plan = await getPlan();

  // A day before the plan's history window shows the week strip (so the way
  // back to today is right there) and the hint, and reads nothing else.
  if (!inHistory(plan, day)) {
    const loggedDays = await getMyFoodDays(week[0], week[6]);
    return (
      <div className="mx-auto max-w-[1600px]">
        <div className="mb-4">
          <FoodViewTabs view="diary" />
        </div>
        <WeekStrip selected={day} today={today} loggedDays={loggedDays} />
        <UpgradeHint
          card
          feature="history"
          upgrade={plan.upgrade}
          values={{ days: plan.e.historyDays ?? 0 }}
          className="mt-5 sm:mt-6"
        />
      </div>
    );
  }

  const [nutrition, planMeals, loggedDays, quick] = await Promise.all([
    getMyDayNutrition(day),
    // The plan for the day being shown, not for today: browsing back to
    // Saturday must show Saturday's meals.
    getMyPlanMeals(day),
    getMyFoodDays(week[0], week[6]),
    getMyQuickFoods(),
  ]);

  const slotLabel: Record<MealSlot, string> = {
    breakfast: t.clientApp.food.breakfast,
    lunch: t.clientApp.food.lunch,
    dinner: t.clientApp.food.dinner,
    snack: t.clientApp.food.snack,
  };

  return (
    <div className="mx-auto max-w-[1600px]">
      <div className="mb-4">
        <FoodViewTabs view="diary" />
      </div>
      <WeekStrip selected={day} today={today} loggedDays={loggedDays} />

      {/* Phone: summary then meals. Desktop: summary pinned left, meals right. */}
      <div className="mt-5 grid gap-4 sm:mt-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:items-start lg:gap-6">
        <div className="lg:sticky lg:top-7">
          <NutritionSummary
            totals={nutrition.totals}
            target={nutrition.target}
            planOwner={nutrition.plan_owner}
            planName={nutrition.plan_name}
          />
        </div>
        <div className="space-y-3.5">
          {SLOTS.map((slot) => (
            <MealCard
              key={slot}
              slot={slot}
              label={slotLabel[slot]}
              day={day}
              entries={nutrition.entries.filter((e) => e.slot === slot)}
              planned={planMeals.find((m) => m.slot === slot)?.foods ?? null}
              quick={quick}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Nutrition over a range: today against the target, the period's averages and
 * adherence against the one before, insights, one chart at a time, this week,
 * and the plan. Every figure is folded here on the server by
 * packages/shared/nutrition-progress from food_daily_totals (one row per day);
 * the target, today's totals and the plan are the diary's own reads, so the
 * two views can never disagree about them.
 *
 * Not gated: what becomes Premium is decided with billing, separately.
 */
async function TrendsView({ state }: { state: FoodState }) {
  const { t } = await getI18n();
  const [trends, nutrition, planMeals] = await Promise.all([
    getMyNutritionTrends(state.range),
    getMyDayNutrition(),
    getMyPlanMeals(),
  ]);
  if (!trends) {
    return <EmptyState title={t.clientApp.today.notSignedInTitle} hint={t.clientApp.today.notSignedInHint} />;
  }
  // No published plan resolves to zeros; zeros are "no target", not a target of 0.
  const target = nutrition.target.kcal > 0 ? nutrition.target : null;
  const windows = progressWindows(trends.today, state.range, trends.firstDay);
  const progress = nutritionProgress(trends.days, windows, target);
  const plannedFoods = planMeals.flatMap((m) => m.foods.map((f) => f.macros));

  return (
    <div className="@container mx-auto max-w-[1600px]">
      <h1 className="sr-only">{t.clientApp.nutritionTrends.trends}</h1>
      <div className="mb-4">
        <FoodViewTabs view="trends" />
      </div>
      <NutritionTrends
        state={state}
        today={{
          totals: nutrition.totals,
          target,
          meals: new Set(nutrition.entries.map((e) => e.slot)).size,
        }}
        progress={progress}
        insights={nutritionInsights(progress)}
        series={nutritionSeries(trends.days, windows.current)}
        week={weekNutrition(trends.days, trends.today, target)}
        plan={
          nutrition.plan_name && nutrition.plan_owner
            ? {
                name: nutrition.plan_name,
                owner: nutrition.plan_owner,
                plannedKcal: plannedFoods.length > 0 ? sumMacros(plannedFoods).kcal : null,
                plannedMeals: planMeals.length,
              }
            : null
        }
        truncated={trends.truncated}
      />
    </div>
  );
}
