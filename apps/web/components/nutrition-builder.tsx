"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { NutritionPlanDetail, PlanMealRow } from "@/lib/types";
import type { DemoFood } from "@/lib/demo-foods";
import {
  addPlanFood,
  publishNutritionPlan,
  removePlanFood,
  searchFoods,
  updatePlanFoodGrams,
} from "@/app/nutrition-actions";
import { Card } from "@/components/ui";
import { useI18n } from "@/lib/i18n/client";
import { fill } from "@/lib/i18n";

// W6 · Nutrition plan builder. Targets and plan totals stay visible at all
// times: the coach is composing against a number, and finding out afterwards
// that the day lands 300 kcal short is the thing this screen exists to prevent.

export function NutritionBuilder({ plan }: { plan: NutritionPlanDetail }) {
  const router = useRouter();
  const { t } = useI18n();
  const m = t.coachWidgets.nutritionBuilder;
  const [pickerMealId, setPickerMealId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<{ ok: boolean; message?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setError(result.message ?? m.somethingWentWrong);
      router.refresh();
    });
  }

  const isEmpty = plan.meals.every((m) => m.foods.length === 0);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            className={`rounded-md px-2 py-0.5 text-xs font-semibold ${
              plan.status === "published" ? "bg-accent-soft text-accent-ink" : "bg-bg text-ink-faint"
            }`}
          >
            {m.status[plan.status]}
          </span>
          <span className="text-sm text-ink-soft">{plan.client_name}</span>
        </div>
        <div className="flex items-center gap-2">
          {error ? <span className="text-sm text-risk">{error}</span> : null}
          <button
            onClick={() => run(() => publishNutritionPlan(plan.id))}
            disabled={pending || isEmpty || plan.status === "published"}
            title={isEmpty ? m.publishHint : undefined}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg hover:opacity-90 disabled:opacity-50"
          >
            {plan.status === "published" ? m.published : m.publish}
          </button>
        </div>
      </div>

      <TargetsCard plan={plan} />

      <div className="mt-4 space-y-4">
        {plan.meals.map((meal) => (
          <MealCard
            key={meal.id}
            meal={meal}
            open={pickerMealId === meal.id}
            pending={pending}
            onToggle={() => setPickerMealId(pickerMealId === meal.id ? null : meal.id)}
            onGrams={(rowId, grams) => run(() => updatePlanFoodGrams(plan.id, rowId, grams))}
            onRemove={(rowId) => run(() => removePlanFood(plan.id, rowId))}
            onPick={(food, grams) =>
              run(() =>
                addPlanFood({ planId: plan.id, mealId: meal.id, foodId: food.id, grams }),
              )
            }
          />
        ))}
      </div>
    </div>
  );
}

function TargetsCard({ plan }: { plan: NutritionPlanDetail }) {
  const { t } = useI18n();
  const rows = [
    { label: t.common.macros.calories, actual: plan.totals.kcal, target: plan.kcal_target, unit: "kcal" },
    { label: t.common.macros.protein, actual: plan.totals.protein, target: plan.protein_target_g, unit: "g" },
    { label: t.common.macros.carbs, actual: plan.totals.carbs, target: plan.carbs_target_g, unit: "g" },
    { label: t.common.macros.fat, actual: plan.totals.fat, target: plan.fat_target_g, unit: "g" },
  ];

  return (
    <Card>
      <div className="grid gap-3 sm:grid-cols-4">
        {rows.map((row) => {
          // Within 5% of target reads as on plan; the spec's macro score uses
          // the same idea of distance from target rather than a hard equality.
          const delta = row.actual - row.target;
          const onTarget = row.target > 0 && Math.abs(delta) / row.target <= 0.05;
          return (
            <div key={row.label}>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                {row.label}
              </p>
              <p className="mt-0.5 text-lg font-bold tabular-nums">
                {round(row.actual)}
                <span className="text-sm font-normal text-ink-faint">
                  {" "}
                  / {row.target} {row.unit}
                </span>
              </p>
              <p
                className={`text-xs tabular-nums ${
                  onTarget ? "text-accent-ink" : delta > 0 ? "text-warn" : "text-ink-soft"
                }`}
              >
                {onTarget
                  ? t.coachWidgets.nutritionBuilder.onTarget
                  : `${delta > 0 ? "+" : ""}${round(delta)} ${row.unit}`}
              </p>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function MealCard({
  meal,
  open,
  pending,
  onToggle,
  onGrams,
  onRemove,
  onPick,
}: {
  meal: PlanMealRow;
  open: boolean;
  pending: boolean;
  onToggle: () => void;
  onGrams: (rowId: string, grams: number) => void;
  onRemove: (rowId: string) => void;
  onPick: (food: DemoFood, grams: number) => void;
}) {
  const { t } = useI18n();
  const m = t.coachWidgets.nutritionBuilder;
  return (
    <Card>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="font-bold">
          {meal.name}{" "}
          <span className="text-sm font-normal text-ink-faint tabular-nums">
            {round(meal.totals.kcal)} kcal
          </span>
        </p>
        <button
          onClick={onToggle}
          className="rounded-lg border border-line px-2 py-1 text-xs font-semibold hover:border-accent hover:text-accent-ink"
        >
          {open ? m.closeFoods : m.addFood}
        </button>
      </div>

      {/* Foods open inside the meal they will be added to, not in a panel
          elsewhere on the page. */}
      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="min-w-0 flex-1">
          {meal.foods.length === 0 ? (
            <p className="rounded-lg border border-dashed border-line px-3 py-3 text-center text-sm text-ink-faint">
              {m.nothingPlanned}
            </p>
          ) : (
            <ul className="space-y-1">
              {meal.foods.map((food) => (
                <li key={food.id} className="flex items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{food.food_name}</span>
                  <GramsInput
                    grams={food.grams}
                    disabled={pending}
                    onCommit={(grams) => onGrams(food.id, grams)}
                  />
                  <span className="w-40 shrink-0 text-right text-xs tabular-nums text-ink-faint">
                    {round(food.macros.kcal)} kcal · {round(food.macros.protein)}P{" "}
                    {round(food.macros.carbs)}C {round(food.macros.fat)}F
                  </span>
                  <button
                    onClick={() => onRemove(food.id)}
                    disabled={pending}
                    title={m.removeFood}
                    className="rounded px-1.5 text-ink-faint hover:bg-risk-soft hover:text-risk disabled:opacity-50"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {open ? (
          <div className="flex h-[26rem] w-full shrink-0 flex-col rounded-lg border border-line bg-bg p-3 lg:w-80">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
              {fill(m.addTo, { name: meal.name })}
            </p>
            <FoodPicker onPick={onPick} />
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function GramsInput({
  grams,
  disabled,
  onCommit,
}: {
  grams: number;
  disabled: boolean;
  onCommit: (grams: number) => void;
}) {
  const [value, setValue] = useState(String(grams));
  const latest = useRef(value);

  return (
    <span className="flex shrink-0 items-center gap-1">
      <input
        type="number"
        min={1}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          latest.current = e.target.value;
          setValue(e.target.value);
        }}
        onBlur={() => onCommit(Number(latest.current))}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        className="w-16 rounded border border-line bg-bg px-1.5 py-1 text-sm tabular-nums outline-none focus:border-accent"
      />
      <span className="text-xs text-ink-faint">g</span>
    </span>
  );
}

function FoodPicker({ onPick }: { onPick: (food: DemoFood, grams: number) => void }) {
  const { t } = useI18n();
  const m = t.coachWidgets.nutritionBuilder;
  const [q, setQ] = useState("");
  const [foods, setFoods] = useState<DemoFood[]>([]);
  const [, startTransition] = useTransition();

  useEffect(() => {
    const timer = setTimeout(() => {
      startTransition(async () => setFoods(await searchFoods(q)));
    }, 200);
    return () => clearTimeout(timer);
  }, [q]);

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={m.searchFoods}
        className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
      />
      <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {foods.map((food) => (
          <li key={food.id} className="rounded-lg border border-line bg-bg p-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="flex items-baseline gap-1.5 text-sm font-semibold">
                  <span className="min-w-0 truncate">{food.name_ro}</span>
                  {food.english_only ? (
                    <span
                      className="shrink-0 rounded border border-line px-1 text-[9px] font-semibold uppercase tracking-wider text-ink-faint"
                      title={m.englishOnlyHint}
                    >
                      {m.englishOnly}
                    </span>
                  ) : null}
                </p>
                <p className="mt-0.5 text-xs text-ink-faint tabular-nums">
                  {food.per_100g.kcal} kcal · {food.per_100g.protein}P {food.per_100g.carbs}C{" "}
                  {food.per_100g.fat}F /100g
                </p>
              </div>
              <button
                onClick={() => onPick(food, 100)}
                className="shrink-0 rounded-lg border border-line px-2.5 py-1 text-xs font-semibold hover:border-accent hover:text-accent-ink"
              >
                {t.common.actions.add}
              </button>
            </div>
          </li>
        ))}
        {foods.length === 0 ? (
          <li className="rounded-lg border border-dashed border-line p-4 text-center text-sm text-ink-soft">
            {m.noMatch}
          </li>
        ) : null}
      </ul>
      <p className="text-[11px] text-ink-faint">{m.addedAt100}</p>
    </div>
  );
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
