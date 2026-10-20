"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteRecipe, logRecipeServings, updateRecipePreparation } from "@/app/recipe-actions";
import { checkRecipeSteps, recipeStepsFromText } from "@healthapp/shared";
import { settle } from "@/lib/settle-action";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { FIELD_INSET } from "@/lib/form-classes";
import type { MyRecipe } from "@/lib/recipes-data";
import type { PlanRecipe } from "@/lib/plan-recipe";
import type { MealSlot } from "@/lib/types";
import { Card } from "./ui";

const SLOTS: MealSlot[] = ["breakfast", "lunch", "dinner", "snack"];

/** One saved recipe: its serving, its lines, the way back to DishFinder, and "add n servings to the diary". */
export function RecipeCard({ recipe }: { recipe: MyRecipe }) {
  const { t } = useI18n();
  const m = t.clientApp.recipes;
  const f = t.clientApp.food;
  const router = useRouter();
  const [servings, setServings] = useState("1");
  const [slot, setSlot] = useState<MealSlot>("lunch");
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const s = recipe.per_serving;
  const slotLabel: Record<MealSlot, string> = { breakfast: f.breakfast, lunch: f.lunch, dinner: f.dinner, snack: f.snack };

  function log() {
    const n = Number(servings.replace(",", "."));
    if (!(n > 0 && n <= 20)) return;
    start(async () => {
      const r = await settle(() => logRecipeServings({ recipeId: recipe.id, servings: n, slot, day: null }), t.common.actions.unreachable);
      setStatus(r.ok ? { ok: true, text: m.logged } : { ok: false, text: r.message ?? m.failed });
      if (r.ok) router.refresh();
    });
  }
  function remove() {
    start(async () => {
      const r = await settle(() => deleteRecipe(recipe.id), t.common.actions.unreachable);
      if (r.ok) router.refresh(); else setStatus({ ok: false, text: r.message ?? m.failed });
    });
  }

  return (
    <Card plain className="flex flex-col sm:p-5">
      <div className="flex gap-3">
        {recipe.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element -- DishFinder's image host is not in next.config
          <img src={recipe.image_url} alt="" className="h-16 w-16 shrink-0 rounded-xl object-cover" />
        ) : null}
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-lg font-bold leading-tight tracking-tight">{recipe.title}</h2>
          <p className="mt-1 text-[12.5px] tabular-nums text-ink-soft">
            <b className="font-semibold text-ink">{s.kcal} kcal</b> · P {s.protein} g · C {s.carbs} g · G {s.fat} g {m.perServing}
          </p>
          <p className="mt-0.5 text-[11.5px] text-ink-faint">
            {fill(m.servingWeight, { grams: recipe.serving_grams })} · {fill(m.madeOf, { servings: recipe.servings })} ·{" "}
            {!recipe.dishfinder_url ? m.ownRecipe : recipe.nutrition_source === "voinic" ? m.adjusted : m.fromDishfinder}
          </p>
          {recipe.dishfinder_url ? (
            <a href={recipe.dishfinder_url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-[12px] font-semibold text-accent-ink hover:underline">
              {m.openDishfinder} ↗
            </a>
          ) : null}
        </div>
      </div>

      {recipe.lines.length > 0 ? (
        <div className="mt-3">
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
            className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint hover:text-ink">
            {m.ingredients} ({recipe.lines.length}) {open ? "▴" : "▾"}
          </button>
          {open ? (
            <ul className="mt-1.5 space-y-0.5 text-[12.5px] text-ink-soft">
              {recipe.lines.map((l, i) => (
                <li key={i}>{l.label}{l.food_name ? <span className="text-ink-faint"> → {l.food_name}</span> : null}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <RecipePreparation recipe={recipe} />

      <div className="mt-4 flex flex-wrap items-end gap-2 rounded-2xl bg-bg p-3">
        <label className="text-[11.5px] font-semibold text-ink-soft">
          {m.servings}
          <input inputMode="decimal" value={servings} onChange={(e) => setServings(e.target.value)} className={`${FIELD_INSET} mt-1 h-9 w-20 tabular-nums`} />
        </label>
        <label className="text-[11.5px] font-semibold text-ink-soft">
          {m.slot}
          <select value={slot} onChange={(e) => setSlot(e.target.value as MealSlot)} className={`${FIELD_INSET} mt-1 h-9 w-32`}>
            {SLOTS.map((x) => <option key={x} value={x}>{slotLabel[x]}</option>)}
          </select>
        </label>
        <button type="button" onClick={log} disabled={pending}
          className="inline-flex h-9 items-center rounded-xl bg-accent px-3.5 text-[12.5px] font-bold text-accent-fg disabled:opacity-50">
          {pending ? m.logging : m.log}
        </button>
      </div>
      {status ? <p role="status" className={`mt-2 text-[12.5px] ${status.ok ? "text-accent-ink" : "text-risk"}`}>{status.text}</p> : null}

      <div className="mt-3 flex justify-end">
        {confirming ? (
          <span className="flex flex-wrap items-center gap-2 text-[12px]">
            <span className="text-ink-soft">{m.removeConfirm}</span>
            <button type="button" onClick={remove} disabled={pending} className="font-semibold text-risk">{m.removeYes}</button>
            <button type="button" onClick={() => setConfirming(false)} className="font-semibold text-ink-faint">{m.cancel}</button>
          </span>
        ) : (
          <button type="button" onClick={() => setConfirming(true)} className="text-[12px] font-semibold text-ink-faint hover:text-risk">{m.remove}</button>
        )}
      </div>
    </Card>
  );
}

/**
 * The recipe's preparation (20261203100000): numbered steps and the two times,
 * folded by default so a list of recipes stays a list. With nothing written it
 * says so — nothing is made up — and offers the owner (every reader of this
 * page: recipes are owner-only) the editor.
 */
export function RecipePreparation({ recipe }: { recipe: Pick<MyRecipe, "id" | "steps" | "prep_minutes" | "cook_minutes"> }) {
  const { t } = useI18n();
  const m = t.clientApp.recipes;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [prep, setPrep] = useState("");
  const [cook, setCook] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const hasSteps = recipe.steps.length > 0;
  const times = [
    recipe.prep_minutes !== null ? fill(m.prepTime, { n: recipe.prep_minutes }) : null,
    recipe.cook_minutes !== null ? fill(m.cookTime, { n: recipe.cook_minutes }) : null,
  ].filter(Boolean).join(" · ");

  function edit() {
    setText(recipe.steps.join("\n"));
    setPrep(recipe.prep_minutes === null ? "" : String(recipe.prep_minutes));
    setCook(recipe.cook_minutes === null ? "" : String(recipe.cook_minutes));
    setError(null);
    setEditing(true);
    setOpen(true);
  }
  const minutes = (v: string): number | null | undefined => {
    if (v.trim() === "") return null;
    const n = Number(v);
    return Number.isInteger(n) && n >= 0 && n <= 1440 ? n : undefined;
  };
  function save() {
    const steps = recipeStepsFromText(text);
    const prepMinutes = minutes(prep);
    const cookMinutes = minutes(cook);
    if (checkRecipeSteps(steps) !== "ok" || prepMinutes === undefined || cookMinutes === undefined) {
      setError(m.tooManySteps);
      return;
    }
    start(async () => {
      const r = await settle(() => updateRecipePreparation({ recipeId: recipe.id, steps, prepMinutes, cookMinutes }), t.common.actions.unreachable);
      if (r.ok) { setEditing(false); router.refresh(); } else setError(r.message ?? m.failed);
    });
  }

  return (
    <div className="mt-3">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint hover:text-ink">
        {m.preparation}{hasSteps ? ` (${recipe.steps.length})` : ""} {open ? "▴" : "▾"}
      </button>
      {times ? <span className="ml-2 text-[11.5px] tabular-nums text-ink-faint">{times}</span> : null}
      {open && !editing ? (
        hasSteps ? (
          <>
            <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-[13px] leading-relaxed text-ink-soft marker:font-semibold marker:text-ink-faint">
              {recipe.steps.map((step, i) => <li key={i}>{step}</li>)}
            </ol>
            <button type="button" onClick={edit} className="mt-2 text-[12px] font-semibold text-accent-ink hover:underline">{m.editSteps}</button>
          </>
        ) : (
          <p className="mt-1.5 text-[12.5px] text-ink-faint">
            {m.noSteps}{" "}
            <button type="button" onClick={edit} className="font-semibold text-accent-ink hover:underline">{m.addSteps}</button>
          </p>
        )
      ) : null}
      {open && editing ? (
        <div className="mt-2 space-y-2 rounded-2xl bg-bg p-3">
          <label className="block text-[11.5px] font-semibold text-ink-soft">
            {m.stepsLabel}
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} placeholder={m.stepsPlaceholder}
              className={`${FIELD_INSET} mt-1 w-full py-2 text-[13px] leading-relaxed`} />
          </label>
          <div className="flex flex-wrap gap-2">
            <label className="text-[11.5px] font-semibold text-ink-soft">
              {m.prepMinutes}
              <input inputMode="numeric" value={prep} onChange={(e) => setPrep(e.target.value)} className={`${FIELD_INSET} mt-1 h-9 w-24 tabular-nums`} />
            </label>
            <label className="text-[11.5px] font-semibold text-ink-soft">
              {m.cookMinutes}
              <input inputMode="numeric" value={cook} onChange={(e) => setCook(e.target.value)} className={`${FIELD_INSET} mt-1 h-9 w-24 tabular-nums`} />
            </label>
          </div>
          <p className="text-[11.5px] text-ink-faint">{m.stepsHint}</p>
          {error ? <p role="alert" className="text-[12.5px] text-risk">{error}</p> : null}
          <div className="flex gap-2">
            <button type="button" onClick={save} disabled={pending}
              className="inline-flex h-9 items-center rounded-xl bg-accent px-3.5 text-[12.5px] font-bold text-accent-fg disabled:opacity-50">
              {pending ? m.savingSteps : m.saveSteps}
            </button>
            <button type="button" onClick={() => setEditing(false)} className="text-[12.5px] font-semibold text-ink-faint hover:text-ink">{m.cancel}</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * A recipe as a planned meal shows it (20261204100000), read-only: the serving,
 * the ingredients with their quantities, then the numbered steps and the times.
 * Kept apart from the meal's foods on purpose — this is how to cook it, not
 * what the day is counted from.
 */
export function RecipeDetails({ recipe }: { recipe: PlanRecipe }) {
  const { t } = useI18n();
  const m = t.clientApp.recipes;
  const times = [
    recipe.prep_minutes !== null ? fill(m.prepTime, { n: recipe.prep_minutes }) : null,
    recipe.cook_minutes !== null ? fill(m.cookTime, { n: recipe.cook_minutes }) : null,
  ].filter(Boolean).join(" · ");
  return (
    <div className="mt-2 space-y-3 rounded-2xl bg-surface p-3.5 text-[13px]">
      <p className="text-[11.5px] text-ink-faint">
        {fill(m.servingWeight, { grams: recipe.serving_grams })} · {fill(m.madeOf, { servings: recipe.servings })}
        {times ? ` · ${times}` : ""}
      </p>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{m.ingredients}</p>
        {recipe.lines.length > 0 ? (
          <ul className="mt-1 space-y-0.5 text-ink-soft">
            {recipe.lines.map((l, i) => (
              <li key={i} className="flex justify-between gap-3">
                <span className="min-w-0">{l.label}</span>
                {l.grams !== null ? <span className="shrink-0 tabular-nums text-ink-faint">{l.grams} g</span> : null}
              </li>
            ))}
          </ul>
        ) : <p className="mt-1 text-ink-faint">—</p>}
      </div>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{m.preparation}</p>
        {recipe.steps.length > 0 ? (
          <ol className="mt-1 list-decimal space-y-1.5 pl-5 leading-relaxed text-ink-soft marker:font-semibold marker:text-ink-faint">
            {recipe.steps.map((step, i) => <li key={i}>{step}</li>)}
          </ol>
        ) : <p className="mt-1 text-ink-faint">{m.noSteps}</p>}
      </div>
    </div>
  );
}

/** The linked recipe of a planned meal, folded: its name, then RecipeDetails on demand. */
export function PlannedRecipe({ recipe, labels }: {
  recipe: PlanRecipe | "unavailable";
  labels: { title: string; show: string; hide: string; unavailable: string };
}) {
  const [open, setOpen] = useState(false);
  if (recipe === "unavailable") return <p className="text-[12px] text-ink-faint">{labels.unavailable}</p>;
  return (
    <div>
      <p className="flex flex-wrap items-center gap-x-2 text-[12.5px]">
        <span className="font-semibold text-ink">{labels.title}</span>
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
          className="font-semibold text-accent-ink hover:underline">
          {open ? labels.hide : labels.show} {open ? "▴" : "▾"}
        </button>
      </p>
      {open ? <RecipeDetails recipe={recipe} /> : null}
    </div>
  );
}
