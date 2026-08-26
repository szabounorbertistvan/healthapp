"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { portionMacros } from "@buddygym/shared";
import { searchFoods } from "@/app/nutrition-actions";
import { logFood } from "@/app/client-actions-app";
import type { DemoFood } from "@/lib/demo-foods";
import type { MealSlot } from "@/lib/types";
import { Card } from "./ui";

const SLOTS: MealSlot[] = ["breakfast", "lunch", "dinner", "snack"];

/**
 * Search a food, set grams, log it. Reuses the coach builder search action so
 * both surfaces hit one food source — demo table now, Open Food Facts through
 * the edge function once a backend is connected.
 */
export function FoodLogger() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<DemoFood[]>([]);
  const [picked, setPicked] = useState<DemoFood | null>(null);
  const [grams, setGrams] = useState("100");
  const [slot, setSlot] = useState<MealSlot>(defaultSlot());
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      startTransition(async () => setResults(await searchFoods(q)));
    }, 200);
    return () => clearTimeout(timer);
  }, [q, open]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-white hover:opacity-90"
      >
        Log food
      </button>
    );
  }

  const gramsNum = parseFloat(grams);
  const preview =
    picked && Number.isFinite(gramsNum) && gramsNum > 0
      ? portionMacros(picked.per_100g, gramsNum)
      : null;

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Log food</p>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setPicked(null);
            setQ("");
          }}
          className="text-xs font-semibold text-ink-faint hover:text-ink"
        >
          Close
        </button>
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {SLOTS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSlot(s)}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold capitalize ${
              slot === s ? "bg-accent text-white" : "bg-bg text-ink-soft"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {picked ? (
        <div className="rounded-lg border border-line p-3">
          <div className="flex items-start justify-between gap-2">
            <p className="font-semibold">{picked.name_ro || picked.name_en}</p>
            <button
              type="button"
              onClick={() => setPicked(null)}
              className="text-xs font-semibold text-ink-faint hover:text-ink"
            >
              Change
            </button>
          </div>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
                grams
              </span>
              <input
                inputMode="decimal"
                value={grams}
                onChange={(e) => setGrams(e.target.value)}
                className="w-24 rounded-lg border border-line bg-surface px-2 py-2 text-sm tabular-nums outline-none focus:border-accent"
              />
            </label>
            {preview ? (
              <p className="pb-2 text-xs tabular-nums text-ink-faint">
                <b className="text-ink">{preview.kcal}</b> kcal · P{preview.protein} · C{preview.carbs} ·
                F{preview.fat}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            disabled={pending || !preview}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                const result = await logFood({
                  slot,
                  foodName: picked.name_ro || picked.name_en,
                  grams: gramsNum,
                  per100g: picked.per_100g,
                });
                if (!result.ok) {
                  setError(result.message ?? "Could not log that");
                  return;
                }
                setPicked(null);
                setQ("");
                setGrams("100");
                router.refresh();
              })
            }
            className="mt-3 w-full rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            Add to {slot}
          </button>
        </div>
      ) : (
        <>
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search foods…"
            className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <ul className="mt-2 max-h-64 divide-y divide-line overflow-y-auto">
            {results.map((food) => (
              <li key={food.id}>
                <button
                  type="button"
                  onClick={() => setPicked(food)}
                  className="flex w-full items-baseline justify-between gap-3 px-1 py-2 text-left text-sm hover:bg-bg"
                >
                  <span className="min-w-0 truncate">{food.name_ro || food.name_en}</span>
                  <span className="shrink-0 text-xs tabular-nums text-ink-faint">
                    {food.per_100g.kcal} kcal/100 g
                  </span>
                </button>
              </li>
            ))}
            {results.length === 0 ? (
              <li className="py-3 text-sm text-ink-faint">No matches.</li>
            ) : null}
          </ul>
        </>
      )}

      {error ? <p className="mt-2 text-sm font-semibold text-risk">{error}</p> : null}
    </Card>
  );
}

/** Guess the meal from the clock so the common case needs no tap. */
function defaultSlot(): MealSlot {
  const hour = new Date().getHours();
  if (hour < 11) return "breakfast";
  if (hour < 16) return "lunch";
  if (hour < 21) return "dinner";
  return "snack";
}
