"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Macros } from "@healthapp/shared";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import type { ClientFoodEntry, MealSlot, QuickFoods } from "@/lib/types";
import { Card } from "./ui";
import { NavIcon } from "./client-nav";
import { FoodEntry } from "./food-entry";
import { FoodLogger } from "./food-logger";
import { logPlannedMeal } from "@/app/client-actions-app";

/** A 24-box icon per slot: a cup, the midday sun, a moon, a piece of fruit. */
const SLOT_ICON: Record<MealSlot, string> = {
  breakfast: "M4 8h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM17 9h2a2 2 0 0 1 0 4h-2M4 21h15",
  lunch: "M12 7a5 5 0 1 0 0 10 5 5 0 1 0 0-10M12 2v2M12 20v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4",
  dinner: "M20 13.5A8 8 0 1 1 10.5 4a6.5 6.5 0 0 0 9.5 9.5z",
  snack: "M12 8c0-2 1.5-3.5 3.5-3.5M8.5 8C6 8 4 10.2 4 13c0 4 3 7.5 5 7.5 1.2 0 1.8-.6 3-.6s1.8.6 3 .6c2 0 5-3.5 5-7.5 0-2.8-2-5-4.5-5-1.6 0-2.3.7-3.5.7S10.1 8 8.5 8z",
};

/**
 * One meal of the day: what was logged, what the coach planned, and a "+"
 * that opens the search right here — the slot is implied by the card, so
 * logging is one tap shorter than picking a meal first.
 */
export function MealCard({
  slot,
  label,
  day,
  entries,
  planned,
  quick,
}: {
  slot: MealSlot;
  label: string;
  day: string;
  entries: ClientFoodEntry[];
  planned: { name: string; grams: number; macros: Macros }[] | null;
  /** Starred and recently logged foods, shared by every meal on the page. */
  quick: QuickFoods;
}) {
  const { t } = useI18n();
  const f = t.clientApp.food;
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [logging, startLogging] = useTransition();
  const kcal = Math.round(entries.reduce((sum, e) => sum + e.macros.kcal, 0));

  return (
    <Card plain>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <NavIcon d={SLOT_ICON[slot]} className="h-7 w-7 shrink-0 text-accent-ink" />
          <div className="min-w-0">
          <h2 className="font-display text-lg font-bold tracking-tight">{label}</h2>
          {entries.length > 0 ? (
            <p className="mt-0.5 text-[12.5px] tabular-nums text-ink-faint">
              <b className="font-semibold text-ink">{kcal}</b> kcal ·{" "}
              {entries.length === 1 ? f.oneItemLogged : fill(f.itemsLogged, { n: entries.length })}
            </p>
          ) : null}
          </div>
        </div>
        {adding ? null : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            aria-label={`${f.addFoods}: ${label}`}
            className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-full bg-accent text-accent-fg hover:opacity-90"
          >
            <NavIcon d="M12 5v14M5 12h14" className="h-4 w-4 [stroke-width:2.4]" />
          </button>
        )}
      </div>

      {entries.length > 0 ? (
        <ul className="mt-2.5 divide-y divide-line/60">
          {entries.map((e) => (
            <FoodEntry key={e.id} entry={e} />
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-[13px] text-ink-faint">{f.noFoodAdded}</p>
      )}

      {planned && planned.length > 0 ? (
        <div className="mt-3 rounded-2xl bg-bg px-3.5 pb-3 pt-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{f.coachPlanned}</p>
          <ul className="mt-1.5 space-y-1 text-[13px] text-ink-soft">
            {planned.map((p, i) => (
              <li key={`${p.name}-${i}`} className="flex justify-between gap-3">
                <span className="truncate">{p.name}</span>
                <span className="shrink-0 tabular-nums text-ink-faint">
                  {p.grams} g · {p.macros.kcal} kcal
                </span>
              </li>
            ))}
          </ul>
          {/* One tap for the whole meal. It is offered only while the slot is
              still empty: once something is logged here the coach's list is a
              reference, and a second tap would be a second dinner. */}
          {entries.length === 0 ? (
            <button
              type="button"
              disabled={logging}
              onClick={() =>
                startLogging(async () => {
                  const result = await logPlannedMeal(slot, day);
                  if (result.ok) router.refresh();
                })
              }
              className="mt-2.5 inline-flex h-9 items-center rounded-full bg-accent px-3.5 font-display text-[12.5px] font-bold text-accent-fg hover:opacity-90 disabled:opacity-50"
            >
              {logging ? f.ateAsPlannedDone : f.ateAsPlanned}
            </button>
          ) : null}
        </div>
      ) : null}

      {adding ? <FoodLogger slot={slot} day={day} quick={quick} onClose={() => setAdding(false)} /> : null}
    </Card>
  );
}
