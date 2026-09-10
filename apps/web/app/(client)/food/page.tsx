import { getMyDayNutrition, getMyFoodDays, getMyPlanMeals } from "@/lib/client-data";
import { isoDay } from "@/lib/demo-client-store";
import { validDay, weekDaysOf } from "@/lib/week";
import { getI18n } from "@/lib/i18n/server";
import { WeekStrip } from "@/components/week-strip";
import { NutritionSummary } from "@/components/nutrition-summary";
import { MealCard } from "@/components/meal-card";
import type { MealSlot } from "@/lib/types";

const SLOTS: MealSlot[] = ["breakfast", "lunch", "dinner", "snack"];

/**
 * The food diary for one day. `?day=yyyy-mm-dd` picks the day (today when
 * absent or malformed), so the week strip is plain links and back/forward
 * work. Layout follows eat&track: week strip → goal/consumed/left ring →
 * macros → one card per meal with "add foods" inside it.
 */
export default async function FoodPage({
  searchParams,
}: {
  searchParams: Promise<{ day?: string }>;
}) {
  const { t } = await getI18n();
  const today = isoDay();
  const day = validDay((await searchParams).day) ?? today;
  const week = weekDaysOf(day);

  const [nutrition, planMeals, loggedDays] = await Promise.all([
    getMyDayNutrition(day),
    getMyPlanMeals(),
    getMyFoodDays(week[0], week[6]),
  ]);

  const slotLabel: Record<MealSlot, string> = {
    breakfast: t.clientApp.food.breakfast,
    lunch: t.clientApp.food.lunch,
    dinner: t.clientApp.food.dinner,
    snack: t.clientApp.food.snack,
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <WeekStrip selected={day} today={today} loggedDays={loggedDays} />

      {/* Phone: summary then meals. Desktop: summary pinned left, meals right. */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:items-start">
        <div className="lg:sticky lg:top-6">
          <NutritionSummary
            totals={nutrition.totals}
            target={nutrition.target}
            planOwner={nutrition.plan_owner}
            planName={nutrition.plan_name}
          />
        </div>
        <div className="space-y-4">
          {SLOTS.map((slot) => (
            <MealCard
              key={slot}
              slot={slot}
              label={slotLabel[slot]}
              day={day}
              entries={nutrition.entries.filter((e) => e.slot === slot)}
              planned={planMeals.find((m) => m.slot === slot)?.foods ?? null}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
