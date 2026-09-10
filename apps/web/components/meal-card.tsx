"use client";
import { useState } from "react";
import type { Macros } from "@healthapp/shared";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import type { ClientFoodEntry, MealSlot } from "@/lib/types";
import { Card } from "./ui";
import { FoodEntry } from "./food-entry";
import { FoodLogger } from "./food-logger";

/**
 * One meal of the day: what was logged, what the coach planned, and an
 * "Add foods" row that opens the search right here — the slot is implied by
 * the card, so logging is one tap shorter than picking a meal first.
 */
export function MealCard({
  slot,
  label,
  day,
  entries,
  planned,
}: {
  slot: MealSlot;
  label: string;
  day: string;
  entries: ClientFoodEntry[];
  planned: { name: string; grams: number; macros: Macros }[] | null;
}) {
  const { t } = useI18n();
  const f = t.clientApp.food;
  const [adding, setAdding] = useState(false);
  const kcal = Math.round(entries.reduce((sum, e) => sum + e.macros.kcal, 0));

  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-bold tracking-tight">{label}</h2>
          {entries.length > 0 ? (
            <p className="text-xs tabular-nums text-ink-faint">
              <b className="text-ink">{kcal}</b> kcal ·{" "}
              {entries.length === 1 ? f.oneItemLogged : fill(f.itemsLogged, { n: entries.length })}
            </p>
          ) : null}
        </div>
        {adding ? null : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            aria-label={`${f.addFoods}: ${label}`}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-lg font-bold leading-none text-accent-fg hover:opacity-90"
          >
            +
          </button>
        )}
      </div>

      {entries.length > 0 ? (
        <ul className="mt-2 divide-y divide-line">
          {entries.map((e) => (
            <FoodEntry key={e.id} entry={e} />
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-ink-faint">{f.noFoodAdded}</p>
      )}

      {planned && planned.length > 0 ? (
        <div className="mt-3 rounded-lg bg-bg px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{f.coachPlanned}</p>
          <ul className="mt-1.5 space-y-1 text-sm text-ink-soft">
            {planned.map((p, i) => (
              <li key={`${p.name}-${i}`} className="flex justify-between gap-3">
                <span className="truncate">{p.name}</span>
                <span className="shrink-0 tabular-nums text-ink-faint">
                  {p.grams} g · {p.macros.kcal} kcal
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {adding ? <FoodLogger slot={slot} day={day} onClose={() => setAdding(false)} /> : null}
    </Card>
  );
}
