"use client";
import { settle } from "@/lib/settle-action";
import { useState, useTransition } from "react";
import { parseDecimal } from "@healthapp/shared";
import { createCustomFood, updateCustomFood } from "@/app/nutrition-actions";
import { useI18n } from "@/lib/i18n/client";
import type { FoodItem } from "@/lib/food-portions";
import type { MyCustomFood } from "@/lib/client-nutrition";

const inputClass = "h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm tabular-nums outline-none focus:border-accent";
const labelClass = "text-[10px] font-semibold uppercase tracking-wider text-ink-faint";
/** foods.portions holds at most 8 (is_valid_food_portions). */
const MAX_PORTIONS = 8;

type PortionDraft = { label: string; grams: string };

/**
 * Create a food the search does not have: a name and the four numbers per
 * 100 g, and — folded away unless a scan brought the person here — what else
 * the label says (saturates, sugars, salt), the barcode, and the person's own
 * servings. Lives inside the food pickers so it opens where the search or the
 * scan came up short; on success the row is handed back so the caller logs or
 * adds it in the same motion. Mirrors NewExerciseForm for exercises.
 * With `editing` it is the same form over one of the person's own foods
 * ("My foods"), saving through updateCustomFood.
 */
export function NewFoodForm({
  initialName = "",
  initialBarcode = "",
  primaryLabel,
  editing,
  onCreated,
  onCancel,
}: {
  initialName?: string;
  /** The code a scan missed: saved with the food so the next scan finds it. */
  initialBarcode?: string;
  /** What the primary button does after saving — "Save and add" or plain "Save food". */
  primaryLabel?: string;
  /** A food of the person's own to change instead of creating a new one. */
  editing?: MyCustomFood;
  onCreated: (food: FoodItem) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const m = t.clientWidgets.newFoodForm;
  const shown = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));
  const [name, setName] = useState(editing?.name ?? initialName);
  const [brand, setBrand] = useState(editing?.brand ?? "");
  const [kcal, setKcal] = useState(shown(editing?.per_100g.kcal));
  const [protein, setProtein] = useState(shown(editing?.per_100g.protein));
  const [carbs, setCarbs] = useState(shown(editing?.per_100g.carbs));
  const [fat, setFat] = useState(shown(editing?.per_100g.fat));
  const [saturated, setSaturated] = useState(shown(editing?.saturatedFat));
  const [sugar, setSugar] = useState(shown(editing?.sugar));
  const [salt, setSalt] = useState(shown(editing?.salt));
  const [barcode, setBarcode] = useState(editing?.barcode ?? initialBarcode);
  const [portions, setPortions] = useState<PortionDraft[]>(
    editing?.portions.map((p) => ({ label: p.label, grams: String(p.grams) })) ?? [],
  );
  // Open the folded part when it holds something: a scanned code, or an edited food's label details.
  const moreOpen =
    initialBarcode !== "" ||
    (editing !== undefined &&
      (editing.saturatedFat !== null || editing.sugar !== null || editing.salt !== null || editing.barcode !== null || editing.portions.length > 0));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Blank is "not given" (0 for a macro, null for a label nutrient); anything
  // else must parse — "60,5" is how a Romanian keyboard types 60.5.
  const given = (v: string) => v.trim() !== "";
  const parses = (v: string) => !given(v) || parseDecimal(v) !== null;
  const macro = (v: string) => (given(v) ? parseDecimal(v) ?? NaN : 0);
  const nutrient = (v: string) => (given(v) ? parseDecimal(v) ?? NaN : null);
  const valid =
    name.trim().length >= 2 &&
    given(kcal) &&
    [kcal, protein, carbs, fat, saturated, sugar, salt].every(parses);

  function submit() {
    if (!valid) return;
    startTransition(async () => {
      setError(null);
      const input = {
        name,
        brand,
        kcal: macro(kcal),
        protein: macro(protein),
        carbs: macro(carbs),
        fat: macro(fat),
        saturatedFat: nutrient(saturated),
        sugar: nutrient(sugar),
        salt: nutrient(salt),
        barcode: barcode.trim() || null,
        portions: portions
          .filter((p) => given(p.label) || given(p.grams))
          .map((p) => ({ label: p.label, grams: parseDecimal(p.grams) ?? NaN })),
      };
      const result = await settle(
        () => (editing ? updateCustomFood(editing.id, input) : createCustomFood(input)),
        t.common.actions.unreachable,
      );
      if (!result.ok || !("food" in result)) {
        setError(result.message || m.couldNotCreate);
        return;
      }
      onCreated(result.food);
    });
  }

  const field = (text: string, value: string, set: (v: string) => void, placeholder = "0") => (
    <label className="flex flex-col gap-1">
      <span className={labelClass}>{text}</span>
      <input value={value} onChange={(e) => set(e.target.value)} inputMode="decimal" placeholder={placeholder} className={inputClass} />
    </label>
  );
  const setPortion = (index: number, patch: Partial<PortionDraft>) =>
    setPortions((list) => list.map((p, i) => (i === index ? { ...p, ...patch } : p)));

  return (
    <div className="space-y-3 rounded-2xl bg-bg p-3.5">
      <div>
        <p className="text-sm font-bold">{editing ? m.editTitle : m.title}</p>
        <p className="mt-0.5 text-xs text-ink-faint">{m.body}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className={labelClass}>{m.name}</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={m.namePlaceholder} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>{m.brand}</span>
          <input value={brand} onChange={(e) => setBrand(e.target.value)} className={inputClass} />
        </label>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {field(m.kcal, kcal, setKcal)}
        {field(m.protein, protein, setProtein)}
        {field(m.carbs, carbs, setCarbs)}
        {field(m.fat, fat, setFat)}
      </div>

      {/* Open by itself when a scan brought the person here: the barcode is
          the point of the form then, and it should be seen being saved. */}
      <details open={moreOpen ? true : undefined} className="rounded-xl border border-line/70 px-3 py-2">
        <summary className="cursor-pointer select-none text-xs font-semibold text-ink-soft hover:text-ink">{m.more}</summary>
        <div className="mt-3 space-y-3 pb-1">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {field(m.saturatedFat, saturated, setSaturated, "")}
            {field(m.sugar, sugar, setSugar, "")}
            {field(m.salt, salt, setSalt, "")}
          </div>
          <div className="flex flex-col gap-1">
            <label className="flex flex-col gap-1">
              <span className={labelClass}>{m.barcode}</span>
              <input value={barcode} onChange={(e) => setBarcode(e.target.value)} inputMode="numeric" className={inputClass} />
            </label>
            <p className="text-[11px] text-ink-faint">{m.barcodeHint}</p>
          </div>
          <div>
            <p className={labelClass}>{m.portions}</p>
            <p className="mt-0.5 text-[11px] text-ink-faint">{m.portionsHint}</p>
            {portions.length > 0 ? (
              <ul className="mt-2 space-y-2">
                {portions.map((portion, index) => (
                  <li key={index} className="flex items-center gap-2">
                    <label className="min-w-0 flex-1">
                      <span className="sr-only">{m.portionLabel}</span>
                      <input
                        value={portion.label}
                        maxLength={16}
                        onChange={(e) => setPortion(index, { label: e.target.value })}
                        placeholder={m.portionLabelPlaceholder}
                        className={inputClass}
                      />
                    </label>
                    <label className="w-24 shrink-0">
                      <span className="sr-only">{m.portionGrams}</span>
                      <input
                        value={portion.grams}
                        inputMode="decimal"
                        onChange={(e) => setPortion(index, { grams: e.target.value })}
                        placeholder="g"
                        className={inputClass}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => setPortions((list) => list.filter((_, i) => i !== index))}
                      aria-label={m.removePortion}
                      title={m.removePortion}
                      className="flex h-11 w-9 shrink-0 items-center justify-center rounded-lg text-lg leading-none text-ink-faint hover:text-risk"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {portions.length < MAX_PORTIONS ? (
              <button
                type="button"
                onClick={() => setPortions((list) => [...list, { label: "", grams: "" }])}
                className="mt-2 text-xs font-semibold text-accent-ink hover:underline"
              >
                + {m.addPortion}
              </button>
            ) : null}
          </div>
        </div>
      </details>

      {error ? <p className="text-sm font-semibold text-risk">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending || !valid}
          onClick={submit}
          className="min-h-11 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-fg disabled:opacity-40"
        >
          {pending ? "…" : primaryLabel ?? m.save}
        </button>
        <button type="button" disabled={pending} onClick={onCancel} className="min-h-11 rounded-lg px-3 text-sm font-semibold text-ink-faint hover:text-ink">
          {t.common.actions.cancel}
        </button>
      </div>
    </div>
  );
}

/** The one-line nudge under a search: "Can't find what you're looking for? Create it". */
export function NotFoundNote({ question, action, onClick, className = "mt-2" }: { question: string; action: string; onClick: () => void; className?: string }) {
  return (
    <p className={`${className} text-xs text-ink-faint`}>
      {question}{" "}
      <button type="button" onClick={onClick} className="font-semibold text-accent-ink hover:underline">
        {action}
      </button>
    </p>
  );
}
