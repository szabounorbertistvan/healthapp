"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { NutritionPlanDetail, PlanMealRow } from "@/lib/types";
import {
  addMealDayVariant,
  addPlanFood,
  publishNutritionPlan,
  removeMealDayVariant,
  removePlanFood,
  searchFoods,
  updatePlanFoodGrams,
} from "@/app/nutrition-actions";
import { Card } from "@/components/ui";
import { NavIcon } from "@/components/client-nav";
import { useI18n } from "@/lib/i18n/client";
import { fill } from "@/lib/i18n";
import { NewFoodForm, NotFoundNote } from "@/components/new-food-form";
import { type FoodItem } from "@/lib/food-portions";

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

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider ${
              plan.status === "published" ? "bg-accent-soft text-accent-ink" : "bg-surface text-ink-faint"
            }`}
          >
            {m.status[plan.status]}
          </span>
          <span className="min-w-0 truncate text-[13px] text-ink-soft">{plan.client_name}</span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {error ? <span className="text-[13px] font-semibold text-risk">{error}</span> : null}
          <button
            onClick={() => run(() => publishNutritionPlan(plan.id))}
            disabled={pending || plan.status === "published"}
            className="flex h-11 items-center justify-center gap-2 rounded-2xl bg-accent px-5 font-display text-sm font-bold text-accent-fg hover:opacity-90 disabled:opacity-50"
          >
            <NavIcon d="m5 12 5 5 9-10" className="h-4 w-4 [stroke-width:2.2]" />
            {plan.status === "published" ? m.published : m.publish}
          </button>
        </div>
      </div>

      {/* The program builder has always said this out loud; the plan builder did
          not, and a coach who set the targets, saw four meal cards and pressed
          publish had no way to tell the plan was still a template. */}
      {plan.status !== "published" ? (
        <p className="mb-4 rounded-2xl bg-warn-soft px-4 py-3 text-[12.5px] font-medium text-warn">
          {fill(m.draftNotice, { name: plan.client_name })}
        </p>
      ) : null}

      <TargetsCard plan={plan} />

      <div className="mt-4 space-y-3.5">
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
            onAddVariant={(dayIndex) => run(() => addMealDayVariant(plan.id, meal.id, dayIndex))}
            onRemoveVariant={() => run(() => removeMealDayVariant(plan.id, meal.id))}
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
    <Card plain className="sm:p-5">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {rows.map((row) => {
          // Within 5% of target reads as on plan; the spec's macro score uses
          // the same idea of distance from target rather than a hard equality.
          const delta = row.actual - row.target;
          const onTarget = row.target > 0 && Math.abs(delta) / row.target <= 0.05;
          return (
            <div key={row.label} className="rounded-2xl bg-bg px-3.5 py-3">
              <p className="truncate text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                {row.label}
              </p>
              <p className="mt-1.5 font-display text-2xl font-extrabold tabular-nums leading-none">
                {round(row.actual)}
                <span className="ml-1 font-sans text-[12px] font-medium text-ink-faint">
                  / {row.target} {row.unit}
                </span>
              </p>
              <p
                className={`mt-1.5 text-[11.5px] font-semibold tabular-nums ${
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
  onAddVariant,
  onRemoveVariant,
}: {
  meal: PlanMealRow;
  open: boolean;
  pending: boolean;
  onToggle: () => void;
  onGrams: (rowId: string, grams: number) => void;
  onRemove: (rowId: string) => void;
  onPick: (food: FoodItem, grams: number) => void;
  onAddVariant: (dayIndex: number) => void;
  onRemoveVariant: () => void;
}) {
  const { t } = useI18n();
  const m = t.coachWidgets.nutritionBuilder;
  return (
    <Card plain className="sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate font-display text-lg font-bold tracking-tight">{meal.name}</h2>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12.5px] tabular-nums text-ink-faint">
            <span>
              <b className="font-semibold text-ink">{round(meal.totals.kcal)}</b> kcal
            </span>
            {/* Which days this meal is for. A plan used to be one day repeated
                for ever, so saying "every day" out loud is what makes the
                weekday variants underneath legible. */}
            <span className="rounded-full bg-bg px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider">
              {meal.day_index === 0
                ? m.everyDay
                : fill(m.onlyOn, { day: m.weekdays[meal.day_index - 1] ?? "?" })}
            </span>
          </p>
        </div>
        <button
          onClick={onToggle}
          className="inline-flex h-9 shrink-0 items-center gap-2 rounded-full bg-bg px-3.5 text-[12.5px] font-semibold text-ink-soft hover:text-ink sm:h-10 sm:px-4"
        >
          <NavIcon
            d={open ? "M6 6 18 18M18 6 6 18" : "M12 5v14M5 12h14"}
            className="h-[15px] w-[15px] [stroke-width:2.2]"
          />
          {open ? m.closeFoods : m.addFood}
        </button>
      </div>

      <DayVariants meal={meal} pending={pending} onAdd={onAddVariant} onRemove={onRemoveVariant} />

      {/* Foods open inside the meal they will be added to, not in a panel
          elsewhere on the page. */}
      <div className="flex flex-col gap-3.5 lg:flex-row">
        <div className="min-w-0 flex-1">
          {meal.foods.length === 0 ? (
            <p className="rounded-2xl bg-bg px-4 py-5 text-center text-[13px] text-ink-faint">
              {m.nothingPlanned}
            </p>
          ) : (
            <ul className="space-y-2">
              {meal.foods.map((food) => (
                <li
                  key={food.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl bg-bg px-4 py-3 text-[14.5px] font-medium"
                >
                  <span className="min-w-0 flex-1 truncate font-medium">{food.food_name}</span>
                  <GramsInput
                    grams={food.grams}
                    disabled={pending}
                    onCommit={(grams) => onGrams(food.id, grams)}
                  />
                  <span className="w-44 shrink-0 text-right text-[12.5px] tabular-nums text-ink-faint">
                    {round(food.macros.kcal)} kcal · {round(food.macros.protein)}P{" "}
                    {round(food.macros.carbs)}C {round(food.macros.fat)}F
                  </span>
                  <button
                    onClick={() => onRemove(food.id)}
                    disabled={pending}
                    title={m.removeFood}
                    aria-label={m.removeFood}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface text-ink-faint hover:bg-risk-soft hover:text-risk disabled:opacity-50"
                  >
                    <NavIcon d="M6 6 18 18M18 6 6 18" className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {open ? (
          <div className="flex h-[26rem] w-full shrink-0 flex-col rounded-2xl bg-bg p-3.5 lg:w-80">
            <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
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
    <span className="flex shrink-0 items-center gap-1.5">
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
        className="w-16 rounded-xl border border-line bg-surface px-2.5 py-2 text-sm tabular-nums outline-none focus:border-accent"
      />
      <span className="text-[11px] font-medium text-ink-faint">g</span>
    </span>
  );
}

function FoodPicker({ onPick }: { onPick: (food: FoodItem, grams: number) => void }) {
  const { t } = useI18n();
  const m = t.coachWidgets.nutritionBuilder;
  const [q, setQ] = useState("");
  const [foods, setFoods] = useState<FoodItem[]>([]);
  const [creating, setCreating] = useState(false);
  const [, startTransition] = useTransition();

  useEffect(() => {
    const timer = setTimeout(() => {
      startTransition(async () => setFoods(await searchFoods(q)));
    }, 200);
    return () => clearTimeout(timer);
  }, [q]);

  if (creating) {
    return (
      <NewFoodForm
        initialName={q}
        primaryLabel={t.clientWidgets.newFoodForm.saveAndLog}
        onCreated={(food) => {
          setCreating(false);
          setFoods((current) => [food, ...current]);
          onPick(food, 100);
        }}
        onCancel={() => setCreating(false)}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <label className="flex h-[42px] items-center gap-2.5 rounded-2xl bg-surface px-3.5 text-ink-faint">
        <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
          <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
        </svg>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={m.searchFoods}
          className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
        />
      </label>
      <NotFoundNote question={m.notFound} action={m.createFood} onClick={() => setCreating(true)} className="" />
      <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {foods.map((food) => (
          <li key={food.id} className="rounded-2xl bg-surface p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="flex items-baseline gap-1.5 text-[13px] font-semibold">
                  <span className="min-w-0 truncate">{food.name_ro}</span>
                  {food.english_only ? (
                    <span
                      className="shrink-0 rounded-full bg-bg px-1.5 text-[9px] font-semibold uppercase tracking-wider text-ink-faint"
                      title={m.englishOnlyHint}
                    >
                      {m.englishOnly}
                    </span>
                  ) : null}
                </p>
                <p className="mt-1 text-[11.5px] tabular-nums text-ink-faint">
                  {food.per_100g.kcal} kcal · {food.per_100g.protein}P {food.per_100g.carbs}C{" "}
                  {food.per_100g.fat}F /100g
                </p>
              </div>
              <button
                onClick={() => onPick(food, 100)}
                className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-bg px-3 text-[12.5px] font-semibold text-accent-ink hover:opacity-90"
              >
                <NavIcon d="M12 5v14M5 12h14" className="h-[15px] w-[15px] [stroke-width:2.2]" />
                {t.common.actions.add}
              </button>
            </div>
          </li>
        ))}
        {foods.length === 0 ? (
          <li className="rounded-2xl bg-surface px-4 py-6 text-center text-[13px] text-ink-soft">
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

/**
 * The weekday row under a meal. On the everyday meal it offers a copy for one
 * day; on a variant it offers only removal — a variant that could be re-dayed
 * would let a coach strand two meals on the same slot and day, and
 * mealsForWeekday would then silently pick one.
 */
function DayVariants({
  meal,
  pending,
  onAdd,
  onRemove,
}: {
  meal: PlanMealRow;
  pending: boolean;
  onAdd: (dayIndex: number) => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  const m = t.coachWidgets.nutritionBuilder;
  const [open, setOpen] = useState(false);

  if (meal.day_index !== 0) {
    return (
      <div className="mb-3">
        <button
          type="button"
          disabled={pending}
          onClick={onRemove}
          className="text-[12.5px] font-semibold text-ink-faint hover:text-risk disabled:opacity-50"
        >
          {m.removeVariant}
        </button>
      </div>
    );
  }

  return (
    <div className="mb-3">
      {open ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {m.weekdays.map((label, i) => (
            <button
              key={label}
              type="button"
              disabled={pending}
              onClick={() => {
                onAdd(i + 1);
                setOpen(false);
              }}
              className="inline-flex h-8 items-center rounded-full bg-bg px-3 text-[12.5px] font-semibold text-ink-soft hover:bg-accent-soft hover:text-accent-ink disabled:opacity-50"
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="ml-1 text-[12.5px] font-semibold text-ink-faint hover:text-ink"
          >
            {t.common.actions.cancel}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title={m.addVariantHint}
          className="text-[12.5px] font-semibold text-accent-ink hover:underline"
        >
          {m.addVariant}
        </button>
      )}
    </div>
  );
}
