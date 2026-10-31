"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useSettledAction } from "@/lib/use-settled-action";
import type { NutritionPlanDetail, PlanFoodRow, PlanMealRow } from "@/lib/types";
import {
  addMealDayVariant,
  addPlanFood,
  publishNutritionPlan,
  addExtraMeal,
  removeExtraMeal,
  removeMealDayVariant,
  removePlanFood,
  renameExtraMeal,
  searchFoods,
  setMealRecipe,
  updatePlanFoodGrams,
} from "@/app/nutrition-actions";
import { PlannedRecipe } from "@/components/recipes";
import type { PlanRecipe } from "@/lib/plan-recipe";
import { FIELD_INSET } from "@/lib/form-classes";
import {
  compareToTarget,
  MAX_EXTRA_MEALS_PER_DAY,
  mealsForWeekday,
  planDayTotals,
  planWeekDays,
  planWeekTotals,
  portionMacros,
  sumMacros,
  type TargetStatus,
} from "@healthapp/shared";
import { Card } from "@/components/ui";
import { NavIcon } from "@/components/client-nav";
import { useI18n } from "@/lib/i18n/client";
import { fill, localizeDefaultName } from "@/lib/i18n";
import { NewFoodForm, NotFoundNote } from "@/components/new-food-form";
import { gramsForPieces, portionsFor, practicalQuantity, type FoodItem, type FoodPortion } from "@/lib/food-portions";
import { usePlan } from "@/lib/plan-client";
import { PremiumSoon, UpgradeHint } from "@/components/upgrade";

// W6 · Nutrition plan builder. Targets and plan totals stay visible at all
// times: the coach is composing against a number, and finding out afterwards
// that the day lands 300 kcal short is the thing this screen exists to prevent.
//
// The plan is a week. "Every day" is the base menu (planned_meals.day_index 0);
// Monday..Sunday show what that day resolves to (mealsForWeekday): the base
// meals, except where the day has a version of its own (day_index 1..7). Only
// the base menu and a day's own versions are editable in place — a base meal
// seen from Tuesday is changed for Tuesday by copying it first, so Monday and
// the other days never move with it.

type Totals = { kcal: number; protein: number; carbs: number; fat: number };

/** 0 = the every-day base menu, 1..7 = ISO weekday. */
type DayView = number;

export function NutritionBuilder({
  plan,
  recipes = [],
  solo = false,
}: {
  plan: NutritionPlanDetail;
  /** The editor's own recipes — the only ones a meal can link (planned_meals_guard). */
  recipes?: { id: string; title: string }[];
  /**
   * A person's own plan (/food/plan): no client to publish to — it is live as
   * it is — and filling meals is not the coaching feature ingredientPlans gates.
   */
  solo?: boolean;
}) {
  const { t } = useI18n();
  const m = t.coachWidgets.nutritionBuilder;
  const [day, setDay] = useState<DayView>(0);
  const [pickerMealId, setPickerMealId] = useState<string | null>(null);
  const { error, pending, run } = useSettledAction(m.somethingWentWrong);
  // What the coach typed but the server has not confirmed yet: the totals
  // follow it immediately, and a value the saved plan already carries is
  // dropped (below), so the refreshed plan takes over without a flicker.
  const [draftGrams, setDraftGrams] = useState<Record<string, number>>({});
  const [removed, setRemoved] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const saved = new Map(plan.meals.flatMap((meal) => meal.foods.map((f) => [f.id, f.grams] as const)));
    setDraftGrams((drafts) => {
      const next = Object.fromEntries(Object.entries(drafts).filter(([id, g]) => saved.has(id) && saved.get(id) !== g));
      return Object.keys(next).length === Object.keys(drafts).length ? drafts : next;
    });
    setRemoved((ids) => {
      const next = new Set([...ids].filter((id) => saved.has(id)));
      return next.size === ids.size ? ids : next;
    });
  }, [plan]);


  const meals = useMemo(() => withDrafts(plan.meals, draftGrams, removed), [plan.meals, draftGrams, removed]);
  const days = useMemo(() => planWeekDays(meals), [meals]);
  const week = planWeekTotals(days);
  const target: Totals = {
    kcal: plan.kcal_target, protein: plan.protein_target_g, carbs: plan.carbs_target_g, fat: plan.fat_target_g,
  };
  const visible = day === 0 ? meals.filter((meal) => meal.day_index === 0) : mealsForWeekday(meals, day);
  const dayTotals = day === 0 ? planDayTotals(meals, 0) : days[day - 1]!;
  const dayName = day === 0 ? m.everyDay : m.weekdaysLong[day - 1]!;

  // The server's grams, not the drafted ones the rows display: a typed value
  // equals the row's (drafted) grams by the time the field loses focus.
  const savedGrams = useMemo(
    () => new Map(plan.meals.flatMap((meal) => meal.foods.map((f) => [f.id, f.grams] as const))),
    [plan.meals],
  );

  function commitGrams(rowId: string, grams: number) {
    if (!(grams > 0) || grams === savedGrams.get(rowId)) {
      setDraftGrams(({ [rowId]: _gone, ...rest }) => rest);
      return;
    }
    setDraftGrams((d) => ({ ...d, [rowId]: grams }));
    run(
      () => updatePlanFoodGrams(plan.id, rowId, grams),
      () => setDraftGrams(({ [rowId]: _gone, ...rest }) => rest),
    );
  }

  function remove(rowId: string) {
    setRemoved((ids) => new Set(ids).add(rowId));
    run(
      () => removePlanFood(plan.id, rowId),
      () => setRemoved((ids) => { const next = new Set(ids); next.delete(rowId); return next; }),
    );
  }

  return (
    <div>
      {solo ? (
        error ? <p role="alert" className="mb-4 text-[13px] font-semibold text-risk">{error}</p> : null
      ) : (
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
          {error ? <span role="alert" className="text-[13px] font-semibold text-risk">{error}</span> : null}
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
      )}

      {/* The program builder has always said this out loud; the plan builder did
          not, and a coach who set the targets, saw four meal cards and pressed
          publish had no way to tell the plan was still a template. */}
      {!solo && plan.status !== "published" ? (
        <p className="mb-4 rounded-2xl bg-warn-soft px-4 py-3 text-[12.5px] font-medium text-warn">
          {fill(m.draftNotice, { name: plan.client_name })}
        </p>
      ) : null}

      <DayTabs day={day} days={days} target={target.kcal} onSelect={(d) => { setDay(d); setPickerMealId(null); }} />

      <TargetsCard
        title={day === 0 ? m.baseTotals : fill(m.dayTotalsFor, { day: dayName })}
        totals={dayTotals}
        target={target}
        meals={visible}
      />
      <p className="mt-2 px-1 text-[12px] tabular-nums text-ink-faint">
        {fill(m.weekLine, { kcal: Math.round(week.kcal), avg: Math.round(week.kcal / 7) })}{" "}
        <span className="text-ink-faint/80">{m.weekHint}</span>
      </p>

      <p className="mt-4 px-1 text-[12.5px] text-ink-soft">
        {day === 0 ? m.everyDayIntro : fill(solo ? m.dayIntroSolo : m.dayIntro, { day: dayName })}
      </p>

      {visible.every((meal) => meal.foods.length === 0) ? (
        <p className="mt-3 rounded-2xl bg-surface px-4 py-4 text-[13px] text-ink-soft">
          <b className="font-semibold text-ink">{fill(m.emptyDay, { day: dayName })}</b>{" "}
          {day === 0 ? m.emptyBaseHint : m.emptyDayHint}
        </p>
      ) : null}

      <div className="mt-3 space-y-3.5">
        {visible.map((meal) => {
          const inherited = day !== 0 && meal.day_index === 0;
          return (
            <MealCard
              key={meal.id}
              meal={meal}
              day={day}
              dayName={dayName}
              inherited={inherited}
              ownDays={day === 0 ? ownVersionDays(meals, meal.slot) : []}
              kcalTarget={target.kcal}
              open={!inherited && pickerMealId === meal.id}
              pending={pending}
              onToggle={() => setPickerMealId(pickerMealId === meal.id ? null : meal.id)}
              onDraft={(rowId, grams) => setDraftGrams((d) => ({ ...d, [rowId]: grams }))}
              onCommit={commitGrams}
              onRemove={remove}
              onPick={(food, grams) =>
                run(() => addPlanFood({ planId: plan.id, mealId: meal.id, foodId: food.id, grams }))
              }
              onCopyToDay={(copyFoods) => run(() => addMealDayVariant(plan.id, meal.id, day, copyFoods))}
              onBackToEveryDay={() => run(() => removeMealDayVariant(plan.id, meal.id))}
              recipes={recipes}
              solo={solo}
              onSetRecipe={(recipeId) => run(() => setMealRecipe(plan.id, meal.id, recipeId))}
              onRename={(name) => run(() => renameExtraMeal(plan.id, meal.id, name))}
              onRemoveMeal={() => run(() => removeExtraMeal(plan.id, meal.id))}
            />
          );
        })}
      </div>

      {/* Extra meals belong to one weekday; the base menu has the fixed slots only. */}
      {day !== 0 ? (
        <ExtraMealForm
          key={day}
          dayName={dayName}
          count={meals.filter((meal) => meal.extra && meal.day_index === day).length}
          pending={pending}
          onAdd={(name, slot) => run(() => addExtraMeal({ planId: plan.id, dayIndex: day, slot, name }))}
        />
      ) : null}
    </div>
  );
}

const SLOTS = ["breakfast", "lunch", "dinner", "snack"] as const;

/** "+ Extra meal" on a weekday: a name and the diary meal it is logged under, at most 4 a day. */
function ExtraMealForm({
  dayName,
  count,
  pending,
  onAdd,
}: {
  dayName: string;
  count: number;
  pending: boolean;
  onAdd: (name: string, slot: (typeof SLOTS)[number]) => void;
}) {
  const { t } = useI18n();
  const m = t.coachWidgets.nutritionBuilder;
  const f = t.clientApp.food;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [slot, setSlot] = useState<(typeof SLOTS)[number]>("snack");
  const full = count >= MAX_EXTRA_MEALS_PER_DAY;
  const slotLabel = { breakfast: f.breakfast, lunch: f.lunch, dinner: f.dinner, snack: f.snack };

  return (
    <Card plain className="mt-3.5 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-display text-base font-bold tracking-tight">{fill(m.extraMeals, { day: dayName })}</h2>
          <p className="mt-0.5 text-[12px] text-ink-faint">
            {fill(m.extraMealsHint, { day: dayName })} · {fill(m.extraCount, { n: count })}
          </p>
        </div>
        {open ? null : (
          <button
            type="button"
            disabled={pending || full}
            onClick={() => setOpen(true)}
            className="inline-flex h-9 shrink-0 items-center rounded-full bg-accent-soft px-3.5 text-[12.5px] font-semibold text-accent-ink hover:opacity-90 disabled:opacity-50"
          >
            {m.addExtra}
          </button>
        )}
      </div>
      {full ? <p className="mt-2 text-[12px] text-ink-faint">{m.extraLimit}</p> : null}
      {open && !full ? (
        <form
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            onAdd(name.trim(), slot);
            setName("");
            setOpen(false);
          }}
        >
          <label className="min-w-0 flex-1 text-[11.5px] font-semibold text-ink-soft">
            {m.extraName}
            <input
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              placeholder={m.extraNamePlaceholder}
              className={`${FIELD_INSET} mt-1 h-9 w-full`}
            />
          </label>
          <label className="text-[11.5px] font-semibold text-ink-soft">
            {m.extraLogsInto}
            <select value={slot} onChange={(e) => setSlot(e.target.value as (typeof SLOTS)[number])} className={`${FIELD_INSET} mt-1 h-9 w-32`}>
              {SLOTS.map((s) => <option key={s} value={s}>{slotLabel[s]}</option>)}
            </select>
          </label>
          <button type="submit" disabled={pending || !name.trim()}
            className="inline-flex h-9 items-center rounded-xl bg-accent px-3.5 text-[12.5px] font-bold text-accent-fg disabled:opacity-50">
            {t.common.actions.add}
          </button>
          <button type="button" onClick={() => setOpen(false)} className="h-9 text-[12.5px] font-semibold text-ink-faint hover:text-ink">
            {t.common.actions.cancel}
          </button>
        </form>
      ) : null}
    </Card>
  );
}

/** The plan with in-flight edits applied, re-costed through the same shared math as the server. */
export function withDrafts(
  meals: readonly PlanMealRow[],
  draftGrams: Record<string, number>,
  removed: ReadonlySet<string>,
): PlanMealRow[] {
  return meals.map((meal) => {
    if (!meal.foods.some((f) => f.id in draftGrams || removed.has(f.id))) return meal;
    const foods = meal.foods
      .filter((f) => !removed.has(f.id))
      .map((f) => {
        const grams = draftGrams[f.id];
        return grams === undefined || !(grams > 0) ? f : { ...f, grams, macros: portionMacros(f.per100g, grams) };
      });
    return { ...meal, foods, totals: sumMacros(foods.map((f) => f.macros)) };
  });
}

/** Weekdays (1..7) on which `slot` has a version of its own. */
function ownVersionDays(meals: readonly PlanMealRow[], slot: string): number[] {
  return [...new Set(meals.filter((m) => m.slot === slot && m.day_index !== 0 && !m.extra).map((m) => m.day_index))].sort();
}

const STATUS_TEXT: Record<TargetStatus, string> = {
  within: "text-accent-ink",
  above: "text-warn",
  below: "text-ink-soft",
  none: "text-ink-faint",
};
const STATUS_DOT: Record<TargetStatus, string> = {
  within: "bg-accent",
  above: "bg-warn",
  below: "bg-ink-faint",
  none: "bg-line",
};

/** Every day + Monday..Sunday, each weekday with its calories and how they sit against the daily target. */
function DayTabs({
  day,
  days,
  target,
  onSelect,
}: {
  day: DayView;
  days: Totals[];
  target: number;
  onSelect: (day: DayView) => void;
}) {
  const { t } = useI18n();
  const m = t.coachWidgets.nutritionBuilder;
  const statusLabel: Record<TargetStatus, string> = {
    within: m.onTarget, above: m.statusAbove, below: m.statusBelow, none: m.noTarget,
  };
  return (
    <div role="tablist" aria-label={m.dayTabsLabel} className="-mx-1 mb-3 flex gap-1.5 overflow-x-auto px-1 pb-1">
      <button
        type="button"
        role="tab"
        aria-selected={day === 0}
        onClick={() => onSelect(0)}
        className={`flex h-14 shrink-0 flex-col items-center justify-center rounded-2xl px-3.5 text-[12.5px] font-semibold ${
          day === 0 ? "bg-accent text-accent-fg" : "bg-surface text-ink-soft hover:text-ink"
        }`}
      >
        {m.everyDay}
        <span className={`mt-0.5 text-[10.5px] font-medium ${day === 0 ? "opacity-80" : "text-ink-faint"}`}>{m.baseMenu}</span>
      </button>
      {days.map((totals, i) => {
        const status = compareToTarget(totals.kcal, target).status;
        const selected = day === i + 1;
        return (
          <button
            key={i}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-label={`${m.weekdaysLong[i]}: ${Math.round(totals.kcal)} kcal, ${statusLabel[status]}`}
            onClick={() => onSelect(i + 1)}
            className={`flex h-14 min-w-[3.75rem] shrink-0 flex-col items-center justify-center rounded-2xl px-2.5 text-[12.5px] font-semibold ${
              selected ? "bg-accent text-accent-fg" : "bg-surface text-ink-soft hover:text-ink"
            }`}
          >
            <span className="flex items-center gap-1.5">
              <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]}`} />
              {m.weekdays[i]}
            </span>
            <span className={`mt-0.5 text-[10.5px] font-medium tabular-nums ${selected ? "opacity-80" : "text-ink-faint"}`}>
              {Math.round(totals.kcal)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function TargetsCard({
  title,
  totals,
  target,
  meals,
}: {
  title: string;
  totals: Totals;
  target: Totals;
  meals: PlanMealRow[];
}) {
  const { t } = useI18n();
  const m = t.coachWidgets.nutritionBuilder;
  const rows = [
    { key: "kcal", label: t.common.macros.calories, actual: totals.kcal, target: target.kcal, unit: "kcal" },
    { key: "protein", label: t.common.macros.protein, actual: totals.protein, target: target.protein, unit: "g" },
    { key: "carbs", label: t.common.macros.carbs, actual: totals.carbs, target: target.carbs, unit: "g" },
    { key: "fat", label: t.common.macros.fat, actual: totals.fat, target: target.fat, unit: "g" },
  ] as const;
  const statusLabel: Record<TargetStatus, string> = {
    within: m.onTarget, above: m.statusAbove, below: m.statusBelow, none: m.noTarget,
  };
  const kcal = compareToTarget(totals.kcal, target.kcal);
  // Which meal carries the day when it runs over: the coach's first question.
  const biggest = kcal.status === "above"
    ? [...meals].sort((a, b) => b.totals.kcal - a.totals.kcal)[0]
    : undefined;

  return (
    <Card plain className="sm:p-5">
      <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{title}</p>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {rows.map((row) => {
          const c = compareToTarget(row.actual, row.target);
          return (
            <div key={row.key} className="rounded-2xl bg-bg px-3.5 py-3" data-status={c.status}>
              <p className="truncate text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                {row.label}
              </p>
              <p className="mt-1.5 font-display text-2xl font-extrabold tabular-nums leading-none">
                {round(row.actual)}
                <span className="ml-1 font-sans text-[12px] font-medium text-ink-faint">
                  / {row.target} {row.unit}
                </span>
              </p>
              <p className={`mt-1.5 text-[11.5px] font-semibold tabular-nums ${STATUS_TEXT[c.status]}`}>
                {statusLabel[c.status]}
                {c.status !== "none" && c.delta !== 0 ? (
                  <span className="font-medium">
                    {" · "}
                    {c.delta > 0 ? "+" : ""}{round(c.delta)} {row.unit}
                    {c.percent !== null ? ` (${c.percent > 0 ? "+" : ""}${c.percent}%)` : ""}
                  </span>
                ) : null}
              </p>
            </div>
          );
        })}
      </div>
      {biggest && biggest.totals.kcal > 0 ? (
        <p className="mt-2.5 text-[12px] text-warn">
          {fill(m.biggestMeal, { meal: biggest.name, kcal: Math.round(biggest.totals.kcal) })}
        </p>
      ) : null}
    </Card>
  );
}

function MealCard({
  meal,
  day,
  dayName,
  inherited,
  ownDays,
  kcalTarget,
  open,
  pending,
  onToggle,
  onDraft,
  onCommit,
  onRemove,
  onPick,
  onCopyToDay,
  onBackToEveryDay,
  recipes,
  onSetRecipe,
  onRename,
  onRemoveMeal,
  solo,
}: {
  meal: PlanMealRow;
  day: DayView;
  dayName: string;
  /** A base-menu meal seen from a weekday: shown, not editable in place. */
  inherited: boolean;
  /** On the base menu: the weekdays that replace this meal with their own. */
  ownDays: number[];
  kcalTarget: number;
  open: boolean;
  pending: boolean;
  onToggle: () => void;
  onDraft: (rowId: string, grams: number) => void;
  onCommit: (rowId: string, grams: number) => void;
  onRemove: (rowId: string) => void;
  onPick: (food: FoodItem, grams: number) => void;
  onCopyToDay: (copyFoods: boolean) => void;
  onBackToEveryDay: () => void;
  recipes: { id: string; title: string }[];
  onSetRecipe: (recipeId: string | null) => void;
  onRename: (name: string) => void;
  onRemoveMeal: () => void;
  solo: boolean;
}) {
  const { t, locale } = useI18n();
  const m = t.coachWidgets.nutritionBuilder;
  const { e: plan, upgrade } = usePlan();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(meal.name);
  const mealName = localizeDefaultName("meal", meal.name, locale);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const canFill = solo || plan.ingredientPlans;
  const share = kcalTarget > 0 ? Math.round((meal.totals.kcal / kcalTarget) * 100) : null;
  return (
    <Card plain className="sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          {renaming ? (
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim() && name.trim() !== meal.name) onRename(name.trim());
                setRenaming(false);
              }}
            >
              <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} aria-label={m.extraName}
                autoFocus className={`${FIELD_INSET} h-9 w-48`} />
              <button type="submit" disabled={pending || !name.trim()} className="text-[12.5px] font-semibold text-accent-ink disabled:opacity-50">{m.save}</button>
              <button type="button" onClick={() => { setName(meal.name); setRenaming(false); }} className="text-[12.5px] font-semibold text-ink-faint">{t.common.actions.cancel}</button>
            </form>
          ) : (
            <h2 className="truncate font-display text-lg font-bold tracking-tight">{mealName}</h2>
          )}
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] tabular-nums text-ink-faint">
            <span>
              <b className="font-semibold text-ink">{round(meal.totals.kcal)}</b> kcal
              {" · "}{round(meal.totals.protein)}P {round(meal.totals.carbs)}C {round(meal.totals.fat)}F
            </span>
            {share !== null && meal.totals.kcal > 0 ? (
              <span>{fill(m.shareOfTarget, { percent: share })}</span>
            ) : null}
            {/* Which days this meal is for: "every day" said out loud is what
                makes a weekday's own version legible. */}
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${
              meal.day_index === 0 ? "bg-bg" : "bg-accent-soft text-accent-ink"
            }`}>
              {meal.day_index === 0
                ? (inherited ? m.inherited : m.everyDay)
                : fill(meal.extra ? m.extraBadge : m.onlyOn, { day: m.weekdays[meal.day_index - 1] ?? "?" })}
            </span>
          </p>
          {ownDays.length > 0 ? (
            <p className="mt-1 text-[11.5px] text-ink-faint">
              {fill(m.overriddenOn, { days: ownDays.map((d) => m.weekdays[d - 1]).join(", ") })}
            </p>
          ) : null}
        </div>
        {inherited ? null : (
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
        )}
      </div>

      {inherited ? (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => onCopyToDay(true)}
            title={fill(m.customizeHint, { day: dayName })}
            className="inline-flex h-9 items-center rounded-full bg-accent-soft px-3.5 text-[12.5px] font-semibold text-accent-ink hover:opacity-90 disabled:opacity-50"
          >
            {fill(m.customize, { day: dayName })}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => onCopyToDay(false)}
            title={fill(m.replaceEmptyHint, { day: dayName })}
            className="inline-flex h-9 items-center rounded-full bg-bg px-3.5 text-[12.5px] font-semibold text-ink-soft hover:text-ink disabled:opacity-50"
          >
            {fill(m.replaceEmpty, { day: dayName })}
          </button>
        </div>
      ) : meal.extra ? (
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] font-semibold">
          {confirmRemove ? (
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-ink-soft">{fill(m.removeExtraConfirm, { name: mealName, day: dayName })}</span>
              <button type="button" disabled={pending} onClick={() => { setConfirmRemove(false); onRemoveMeal(); }} className="text-risk disabled:opacity-50">{m.removeExtraYes}</button>
              <button type="button" onClick={() => setConfirmRemove(false)} className="text-ink-faint">{t.common.actions.cancel}</button>
            </span>
          ) : (
            <>
              <button type="button" disabled={pending} onClick={() => setRenaming(true)} className="text-ink-faint hover:text-ink disabled:opacity-50">{m.rename}</button>
              <button type="button" disabled={pending} onClick={() => setConfirmRemove(true)} className="text-ink-faint hover:text-risk disabled:opacity-50">{m.removeExtra}</button>
            </>
          )}
        </div>
      ) : day !== 0 && meal.day_index === day ? (
        <div className="mb-3">
          <button
            type="button"
            disabled={pending}
            onClick={onBackToEveryDay}
            className="text-[12.5px] font-semibold text-ink-faint hover:text-risk disabled:opacity-50"
          >
            {m.backToEveryDay}
          </button>
        </div>
      ) : null}

      <MealRecipe meal={meal} editable={!inherited} recipes={recipes} pending={pending} onSet={onSetRecipe} />

      {/* Foods open inside the meal they will be added to, not in a panel
          elsewhere on the page. */}
      <div className="flex flex-col gap-3.5 lg:flex-row">
        <div className="min-w-[11rem] flex-1">
          {meal.foods.length === 0 ? (
            <p className="rounded-2xl bg-bg px-4 py-5 text-center text-[13px] text-ink-faint">
              {m.nothingPlanned}
            </p>
          ) : (
            <ul className="space-y-2">
              {meal.foods.map((food) => (
                <FoodRow
                  key={food.id}
                  food={food}
                  editable={!inherited}
                  pending={pending}
                  onDraft={(grams) => onDraft(food.id, grams)}
                  onCommit={(grams) => onCommit(food.id, grams)}
                  onRemove={() => onRemove(food.id)}
                />
              ))}
            </ul>
          )}
        </div>

        {/* Filling a meal with foods is Coach Pro; a Starter plan is its targets. */}
        {open && !canFill ? (
          <UpgradeHint feature="ingredientPlans" upgrade={upgrade} className="w-full shrink-0 self-start lg:w-80" />
        ) : open ? (
          <div className="flex h-[clamp(32rem,82vh,64rem)] w-full shrink-0 flex-col rounded-2xl bg-bg p-3.5 lg:w-80">
            <p className="mb-2.5 flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
              {fill(m.addTo, { name: mealName })}
              {solo ? null : <PremiumSoon feature="ingredientPlans" />}
            </p>
            <FoodPicker onPick={onPick} />
          </div>
        ) : null}
      </div>
    </Card>
  );
}

/**
 * One planned food: its everyday quantity ("2 × M · 100 g edible") when one of
 * its servings measures it, the grams field for precision, and — for foods that
 * have servings — size chips with a − / + count that write grams.
 */
function FoodRow({
  food,
  editable,
  pending,
  onDraft,
  onCommit,
  onRemove,
}: {
  food: PlanFoodRow;
  editable: boolean;
  pending: boolean;
  onDraft: (grams: number) => void;
  onCommit: (grams: number) => void;
  onRemove: () => void;
}) {
  const { t, locale } = useI18n();
  const m = t.coachWidgets.nutritionBuilder;
  const portions = portionsFor({ id: food.food_id ?? "", name_en: food.food_name_en, name_ro: food.food_name, portions: food.portions });
  const practical = practicalQuantity(food.grams, portions);
  const count = (n: number) => n.toLocaleString(locale === "ro" ? "ro-RO" : "en-GB", { maximumFractionDigits: 1 });
  const unitPortion = practical ? portions.find((p) => p.label.replace(/^1\s+/, "") === practical.unit) : undefined;

  function setPieces(portion: FoodPortion, n: number) {
    if (n <= 0) return;
    onCommit(gramsForPieces(n, portion.grams));
  }

  return (
    <li className="rounded-2xl bg-bg px-4 py-3 text-[14.5px] font-medium">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-[11rem] flex-1">
          <p className="truncate font-medium">{food.food_name}</p>
          <p className="mt-0.5 text-[12px] tabular-nums text-ink-faint" title={practical?.note || undefined}>
            {practical
              ? fill(practical.exact ? m.practicalExact : m.practicalApprox, {
                  count: count(practical.count),
                  unit: practical.unit,
                  grams: round(food.grams),
                }) + (practical.edible ? ` ${m.edible}` : "")
              : `${round(food.grams)} g`}
          </p>
        </div>
        {editable ? (
          <GramsInput
            grams={food.grams}
            disabled={pending}
            onDraft={onDraft}
            onCommit={onCommit}
          />
        ) : null}
        <span className="min-w-0 flex-1 text-[12.5px] tabular-nums text-ink-faint sm:w-44 sm:flex-none sm:shrink-0 sm:text-right">
          {round(food.macros.kcal)} kcal · {round(food.macros.protein)}P{" "}
          {round(food.macros.carbs)}C {round(food.macros.fat)}F
        </span>
        {editable ? (
          <button
            onClick={onRemove}
            disabled={pending}
            title={m.removeFood}
            aria-label={m.removeFood}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface text-ink-faint hover:bg-risk-soft hover:text-risk disabled:opacity-50"
          >
            <NavIcon d="M6 6 18 18M18 6 6 18" className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      {editable && portions.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px]">
          <span className="font-semibold text-ink-faint">{m.servingSize}</span>
          {portions.map((p) => (
            <button
              key={p.label}
              type="button"
              disabled={pending}
              title={p.note}
              aria-pressed={unitPortion?.label === p.label}
              onClick={() => setPieces(p, 1)}
              className={`inline-flex h-8 items-center rounded-full px-2.5 font-semibold tabular-nums disabled:opacity-50 ${
                unitPortion?.label === p.label ? "bg-accent-soft text-accent-ink" : "bg-surface text-ink-soft hover:text-ink"
              }`}
            >
              {p.label} · {p.grams} g
            </button>
          ))}
          {unitPortion && practical ? (
            <span className="ml-1 inline-flex items-center gap-1">
              <button
                type="button"
                disabled={pending || practical.count <= 1}
                onClick={() => setPieces(unitPortion, Math.ceil(practical.count) - 1)}
                aria-label={m.fewerPieces}
                className="grid h-8 w-8 place-items-center rounded-full bg-surface font-bold text-ink-soft disabled:opacity-40"
              >
                −
              </button>
              <span className="min-w-6 text-center font-semibold tabular-nums">{count(practical.count)}</span>
              <button
                type="button"
                disabled={pending || practical.count >= 20}
                onClick={() => setPieces(unitPortion, Math.floor(practical.count) + 1)}
                aria-label={m.morePieces}
                className="grid h-8 w-8 place-items-center rounded-full bg-surface font-bold text-ink-soft disabled:opacity-40"
              >
                +
              </button>
            </span>
          ) : null}
        </div>
      ) : editable ? (
        <p className="mt-1.5 text-[11.5px] text-ink-faint">{m.noServing}</p>
      ) : null}
    </li>
  );
}

function GramsInput({
  grams,
  disabled,
  onDraft,
  onCommit,
}: {
  grams: number;
  disabled: boolean;
  onDraft: (grams: number) => void;
  onCommit: (grams: number) => void;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState(String(grams));
  // A chip, the − / + count or a refresh changes the grams from outside.
  useEffect(() => setValue((v) => (Number(v) === grams ? v : String(grams))), [grams]);

  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <input
        type="number"
        min={1}
        step="any"
        inputMode="decimal"
        value={value}
        disabled={disabled}
        aria-label={t.coachWidgets.nutritionBuilder.gramsLabel}
        onChange={(e) => {
          setValue(e.target.value);
          const n = Number(e.target.value);
          if (n > 0) onDraft(n);
        }}
        onBlur={() => {
          const n = Number(value);
          if (n > 0) onCommit(n);
          else setValue(String(grams));
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        className="w-20 rounded-xl border border-line bg-surface px-2.5 py-2 text-sm tabular-nums outline-none focus:border-accent"
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
  // Same fold as the client's logger: Romanian-named rows are the list, the
  // untranslated USDA tail opens on request (or is the list when it is all there is).
  const [showEnglish, setShowEnglish] = useState(false);
  const mainFoods = foods.filter((food) => !food.english_only);
  const englishTail = foods.filter((food) => food.english_only);
  const visibleFoods = showEnglish || mainFoods.length === 0 ? [...mainFoods, ...englishTail] : mainFoods;

  useEffect(() => {
    setShowEnglish(false);
    const timer = setTimeout(() => {
      startTransition(async () => setFoods(await searchFoods(q)));
    }, 200);
    return () => clearTimeout(timer);
  }, [q]);

  if (creating) {
    // The picker sits in a fixed-height box whose only scroller is the list;
    // the form takes that scroll, or its Save button ends up under the box's
    // edge on a phone.
    return (
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
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
      </div>
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
        {visibleFoods.map((food) => (
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
        {englishTail.length > 0 && mainFoods.length > 0 && !showEnglish ? (
          <li>
            <button
              type="button"
              onClick={() => setShowEnglish(true)}
              className="w-full rounded-2xl bg-surface px-4 py-3 text-left text-[12.5px] font-semibold text-accent-ink hover:opacity-90"
            >
              {fill(m.moreEnglish, { count: englishTail.length })}
            </button>
          </li>
        ) : null}
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
 * The meal's linked recipe (20261204100000): its name and, folded, the
 * ingredients, steps and times; for the editor, a picker of their own recipes
 * and "unlink". A reference only — the meal is still counted from its foods.
 */
function MealRecipe({
  meal,
  editable,
  recipes,
  pending,
  onSet,
}: {
  meal: PlanMealRow;
  editable: boolean;
  recipes: { id: string; title: string }[];
  pending: boolean;
  onSet: (recipeId: string | null) => void;
}) {
  const { t } = useI18n();
  const m = t.coachWidgets.nutritionBuilder;
  const [choice, setChoice] = useState("");
  const linked = meal.recipe !== "none";
  if (!linked && !editable) return null;

  return (
    <div className="mb-3 rounded-2xl bg-bg px-3.5 py-2.5">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{m.recipe}</p>
      {linked ? (
        <div className="mt-1 flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-[11rem] flex-1">
            <PlannedRecipe
              recipe={meal.recipe as PlanRecipe | "unavailable"}
              labels={{
                title: meal.recipe === "unavailable" || meal.recipe === "none" ? "" : meal.recipe.title,
                show: m.showRecipe,
                hide: m.hideRecipe,
                unavailable: m.recipeUnavailable,
              }}
            />
            <p className="mt-1 text-[11.5px] text-ink-faint">{m.recipeHint}</p>
          </div>
          {editable ? (
            <button type="button" disabled={pending} onClick={() => onSet(null)}
              className="text-[12.5px] font-semibold text-ink-faint hover:text-risk disabled:opacity-50">
              {m.unlinkRecipe}
            </button>
          ) : null}
        </div>
      ) : recipes.length === 0 ? (
        <p className="mt-1 text-[12px] text-ink-faint">{m.noRecipes}</p>
      ) : (
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <select value={choice} onChange={(e) => setChoice(e.target.value)} aria-label={m.chooseRecipe}
            className={`${FIELD_INSET} h-9 min-w-0 max-w-full flex-1 sm:max-w-xs`}>
            <option value="">{m.chooseRecipe}</option>
            {recipes.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
          </select>
          <button type="button" disabled={pending || !choice} onClick={() => { onSet(choice); setChoice(""); }}
            className="inline-flex h-9 items-center rounded-xl bg-accent px-3.5 text-[12.5px] font-bold text-accent-fg disabled:opacity-50">
            {m.linkRecipe}
          </button>
        </div>
      )}
    </div>
  );
}
