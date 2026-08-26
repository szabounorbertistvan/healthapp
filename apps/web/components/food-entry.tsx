"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { portionMacros } from "@buddygym/shared";
import { deleteFoodLog, updateFoodLog } from "@/app/client-actions-app";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import type { ClientFoodEntry } from "@/lib/types";

/**
 * A logged portion, correctable in place. Mistyping grams is the most common
 * logging error, so fixing it is an inline edit rather than delete-and-relog.
 */
export function FoodEntry({ entry }: { entry: ClientFoodEntry }) {
  const { t } = useI18n();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [grams, setGrams] = useState(String(entry.grams));
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const gramsNum = parseFloat(grams);
  const valid = Number.isFinite(gramsNum) && gramsNum > 0;
  // Recover the per-100g basis so the preview matches what the server will store.
  const per100g = {
    kcal: (entry.macros.kcal * 100) / entry.grams,
    protein: (entry.macros.protein * 100) / entry.grams,
    carbs: (entry.macros.carbs * 100) / entry.grams,
    fat: (entry.macros.fat * 100) / entry.grams,
  };
  const preview = valid ? portionMacros(per100g, gramsNum) : entry.macros;

  function save() {
    if (!valid) return;
    startTransition(async () => {
      setError(null);
      const result = await updateFoodLog(entry.id, gramsNum);
      if (!result.ok) {
        setError(result.message ?? t.clientWidgets.foodEntry.couldNotUpdate);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  function remove() {
    startTransition(async () => {
      setError(null);
      const result = await deleteFoodLog(entry.id);
      if (!result.ok) {
        setError(result.message ?? t.clientWidgets.foodEntry.couldNotDelete);
        return;
      }
      setConfirming(false);
      router.refresh();
    });
  }

  if (editing) {
    return (
      <li className={`py-2 ${pending ? "opacity-60" : ""}`}>
        <p className="text-sm font-semibold">{entry.food_name}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            autoFocus
            inputMode="decimal"
            value={grams}
            onChange={(e) => setGrams(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") {
                setGrams(String(entry.grams));
                setEditing(false);
              }
            }}
            className="w-24 rounded-lg border border-line bg-surface px-2 py-1.5 text-sm tabular-nums outline-none focus:border-accent"
          />
          <span className="text-xs text-ink-faint">g</span>
          <span className="text-xs tabular-nums text-ink-faint">
            → <b className="text-ink">{preview.kcal}</b> kcal · P{preview.protein}
          </span>
          <button
            type="button"
            disabled={pending || !valid}
            onClick={save}
            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
          >
            {t.common.actions.save}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setGrams(String(entry.grams));
              setEditing(false);
            }}
            className="rounded-lg px-2 py-1.5 text-xs font-semibold text-ink-faint hover:text-ink"
          >
            {t.common.actions.cancel}
          </button>
        </div>
        {error ? <p className="mt-1 text-xs font-semibold text-risk">{error}</p> : null}
      </li>
    );
  }

  return (
    <li className={`group flex items-baseline justify-between gap-3 py-1.5 text-sm ${pending ? "opacity-60" : ""}`}>
      <span className="min-w-0 truncate">
        {entry.food_name}
        <span className="ml-1 text-xs text-ink-faint">{entry.grams} g</span>
      </span>
      <span className="flex shrink-0 items-baseline gap-2">
        <span className="tabular-nums text-ink-faint">
          <b className="text-ink">{entry.macros.kcal}</b> kcal · P{entry.macros.protein}
        </span>
        {confirming ? (
          <>
            <button
              type="button"
              disabled={pending}
              onClick={remove}
              className="rounded-md bg-risk px-2 py-0.5 text-xs font-semibold text-white"
            >
              {t.common.actions.delete}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setConfirming(false)}
              className="text-xs font-semibold text-ink-faint hover:text-ink"
            >
              {t.clientWidgets.foodEntry.keep}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-xs font-semibold text-ink-faint hover:text-accent-ink"
              aria-label={fill(t.clientWidgets.foodEntry.editAria, { name: entry.food_name })}
            >
              {t.common.actions.edit}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="text-xs font-semibold text-ink-faint hover:text-risk"
              aria-label={fill(t.clientWidgets.foodEntry.removeAria, { name: entry.food_name })}
            >
              ✕
            </button>
          </>
        )}
      </span>
      {error ? <p className="text-xs font-semibold text-risk">{error}</p> : null}
    </li>
  );
}
