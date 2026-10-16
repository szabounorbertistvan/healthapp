"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteRecipe, logRecipeServings } from "@/app/recipe-actions";
import { settle } from "@/lib/settle-action";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { FIELD_INSET } from "@/lib/form-classes";
import type { MyRecipe } from "@/lib/recipes-data";
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
            {recipe.nutrition_source === "voinic" ? m.adjusted : m.fromDishfinder}
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
