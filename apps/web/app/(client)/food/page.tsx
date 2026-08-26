import { getMyDayNutrition, getMyPlanMeals } from "@/lib/client-data";
import { Card, PageTitle } from "@/components/ui";
import { MacroPanel } from "@/components/client-ui";
import { FoodLogger } from "@/components/food-logger";
import { getI18n } from "@/lib/i18n/server";
import type { MealSlot } from "@/lib/types";

const SLOTS: MealSlot[] = ["breakfast", "lunch", "dinner", "snack"];

export default async function FoodPage() {
  const { t } = await getI18n();
  const [day, planMeals] = await Promise.all([getMyDayNutrition(), getMyPlanMeals()]);

  const slotLabel: Record<MealSlot, string> = {
    breakfast: t.clientApp.food.breakfast,
    lunch: t.clientApp.food.lunch,
    dinner: t.clientApp.food.dinner,
    snack: t.clientApp.food.snack,
  };

  return (
    <div className="space-y-4">
      <PageTitle title={t.common.nav.nutrition} />

      <MacroPanel
        totals={day.totals}
        target={day.target}
        title={day.plan_name ?? t.common.macros.todayTitle}
      />

      <FoodLogger />

      {SLOTS.map((slot) => {
        const entries = day.entries.filter((e) => e.slot === slot);
        const planned = planMeals.find((m) => m.slot === slot);
        if (entries.length === 0 && !planned) return null;
        return (
          <Card key={slot}>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
              {slotLabel[slot]}
            </p>

            {entries.length > 0 ? (
              <ul className="space-y-1.5">
                {entries.map((e) => (
                  <li key={e.id} className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate">
                      {e.food_name}
                      <span className="ml-1 text-xs text-ink-faint">{e.grams} g</span>
                    </span>
                    <span className="shrink-0 tabular-nums text-ink-faint">
                      <b className="text-ink">{e.macros.kcal}</b> kcal · P{e.macros.protein}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-faint">{t.clientApp.food.nothingLogged}</p>
            )}

            {planned && planned.foods.length > 0 ? (
              <div className="mt-3 border-t border-line pt-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                  {t.clientApp.food.coachPlanned}
                </p>
                <ul className="mt-1.5 space-y-1 text-sm text-ink-soft">
                  {planned.foods.map((f, i) => (
                    <li key={`${f.name}-${i}`} className="flex justify-between gap-3">
                      <span className="truncate">{f.name}</span>
                      <span className="shrink-0 tabular-nums text-ink-faint">
                        {f.grams} g · {f.macros.kcal} kcal
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Card>
        );
      })}
    </div>
  );
}
