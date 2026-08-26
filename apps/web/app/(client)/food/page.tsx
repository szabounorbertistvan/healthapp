import { getMyDayNutrition, getMyPlanMeals } from "@/lib/client-data";
import { Card, PageTitle } from "@/components/ui";
import { MacroPanel } from "@/components/client-ui";
import { FoodLogger } from "@/components/food-logger";
import { FoodEntry } from "@/components/food-entry";
import type { MealSlot } from "@/lib/types";

const SLOTS: MealSlot[] = ["breakfast", "lunch", "dinner", "snack"];
const SLOT_LABEL: Record<MealSlot, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
};

export default async function FoodPage() {
  const [day, planMeals] = await Promise.all([getMyDayNutrition(), getMyPlanMeals()]);

  return (
    <div className="space-y-4">
      <PageTitle title="Nutrition" />

      <MacroPanel
        totals={day.totals}
        target={day.target}
        title={day.plan_name ?? "Today"}
      />

      <FoodLogger />

      {SLOTS.map((slot) => {
        const entries = day.entries.filter((e) => e.slot === slot);
        const planned = planMeals.find((m) => m.slot === slot);
        if (entries.length === 0 && !planned) return null;
        return (
          <Card key={slot}>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
              {SLOT_LABEL[slot]}
            </p>

            {entries.length > 0 ? (
              <ul className="divide-y divide-line">
                {entries.map((e) => (
                  <FoodEntry key={e.id} entry={e} />
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-faint">Nothing logged.</p>
            )}

            {planned && planned.foods.length > 0 ? (
              <div className="mt-3 border-t border-line pt-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                  Your coach planned
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
