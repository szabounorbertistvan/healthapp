"use client";
import { useState, useTransition } from "react";
import { createCustomFood } from "@/app/nutrition-actions";
import { useI18n } from "@/lib/i18n/client";
import type { DemoFood } from "@/lib/demo-foods";

const inputClass = "w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm tabular-nums outline-none focus:border-accent";
const labelClass = "text-[10px] font-semibold uppercase tracking-wider text-ink-faint";

/**
 * Create a food the search does not have: a name and the four numbers per
 * 100 g. Lives inside the food pickers so it opens where the search came up
 * short; on success the row is handed back so the caller logs or adds it in
 * the same motion. Mirrors NewExerciseForm for exercises.
 */
export function NewFoodForm({
  initialName = "",
  primaryLabel,
  onCreated,
  onCancel,
}: {
  initialName?: string;
  /** What the primary button does after saving — "Save and add" or plain "Save food". */
  primaryLabel?: string;
  onCreated: (food: DemoFood) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const m = t.clientWidgets.newFoodForm;
  const [name, setName] = useState(initialName);
  const [brand, setBrand] = useState("");
  const [kcal, setKcal] = useState("");
  const [protein, setProtein] = useState("");
  const [carbs, setCarbs] = useState("");
  const [fat, setFat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const num = (v: string) => Number(v.replace(",", "."));
  const valid = name.trim().length >= 2 && kcal.trim() !== "" && Number.isFinite(num(kcal));

  function submit() {
    if (!valid) return;
    startTransition(async () => {
      setError(null);
      const result = await createCustomFood({
        name,
        brand,
        kcal: num(kcal),
        protein: protein.trim() === "" ? 0 : num(protein),
        carbs: carbs.trim() === "" ? 0 : num(carbs),
        fat: fat.trim() === "" ? 0 : num(fat),
      });
      if (!result.ok) {
        setError(result.message || m.couldNotCreate);
        return;
      }
      onCreated(result.food);
    });
  }

  const field = (label: string, value: string, set: (v: string) => void, placeholder = "0") => (
    <label className="flex flex-col gap-1">
      <span className={labelClass}>{label}</span>
      <input value={value} onChange={(e) => set(e.target.value)} inputMode="decimal" placeholder={placeholder} className={inputClass} />
    </label>
  );

  return (
    <div className="space-y-3 rounded-lg border border-accent bg-surface p-3">
      <div>
        <p className="text-sm font-bold">{m.title}</p>
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
