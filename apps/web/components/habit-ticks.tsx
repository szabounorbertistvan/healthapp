"use client";
import { useState, useTransition, useOptimistic } from "react";
import { archiveHabit, toggleHabit } from "@/app/client-actions-app";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/client";
import { suggestionKeyForName } from "@/lib/habit-suggestions";
import type { ClientHabitRow } from "@/lib/types";
import { NavIcon } from "./client-nav";

const CHECK = "m5 12 5 5 9-10";
const CLOSE = "M6 6 18 18M18 6 6 18";

/**
 * Ticking a habit is the smallest, most-repeated action in the app, so it
 * updates optimistically — the checkbox must not wait on a round trip. A habit
 * that came from one of the suggestions keeps an ⓘ that unfolds what it is and
 * why it is worth doing.
 *
 * Two contexts, one component: on the Habits page (`removable`) it is the full
 * list, with hairlines between the rows; inside the Today checklist it sits in
 * a tight indented column, so the row stays compact and carries no gutter of
 * its own.
 */
export function HabitTicks({ habits, removable = false }: { habits: ClientHabitRow[]; removable?: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [openInfo, setOpenInfo] = useState<string | null>(null);
  // Removing asks first, inline: "Delete habit?" with Cancel / Delete.
  const [confirming, setConfirming] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [rows, toggleOptimistic] = useOptimistic(habits, (state, id: string) =>
    state.map((h) =>
      h.id === id
        ? {
            ...h,
            done_today: !h.done_today,
            done_this_week: h.done_this_week + (h.done_today ? -1 : 1),
          }
        : h,
    ),
  );

  return (
    <ul className={`${removable ? "divide-y divide-line/60" : "space-y-0.5"} ${pending ? "opacity-70" : ""}`}>
      {rows.map((habit) => {
        const key = suggestionKeyForName(habit.name);
        const info = key ? t.clientWidgets.habitSuggestions[key] : null;
        const showing = openInfo === habit.id;
        return (
          <li key={habit.id} className={removable ? "py-1" : ""}>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() =>
                  startTransition(async () => {
                    toggleOptimistic(habit.id);
                    await toggleHabit(habit.id);
                  })
                }
                className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-1.5 py-1.5 text-left hover:bg-bg"
              >
                <span
                  aria-hidden
                  className={`grid h-5 w-5 shrink-0 place-items-center rounded-[7px] border-[1.5px] ${
                    habit.done_today
                      ? "border-accent bg-accent text-accent-fg"
                      : "border-line text-transparent"
                  }`}
                >
                  <NavIcon d={CHECK} className="h-3 w-3 [stroke-width:3]" />
                </span>
                <span
                  className={`min-w-0 flex-1 truncate text-[13.5px] font-medium ${
                    habit.done_today ? "text-ink-faint line-through" : ""
                  }`}
                >
                  {habit.name}
                </span>
                <span className="shrink-0 text-[12.5px] font-semibold tabular-nums text-ink-faint">
                  {habit.done_this_week}/{habit.target_per_week}
                </span>
              </button>
              {info ? (
                <button
                  type="button"
                  aria-expanded={showing}
                  aria-label={t.clientApp.habits.what}
                  onClick={() => setOpenInfo(showing ? null : habit.id)}
                  className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold ${
                    showing ? "bg-accent text-accent-fg" : "bg-bg text-ink-faint hover:text-ink"
                  }`}
                >
                  i
                </button>
              ) : null}
              {removable ? (
                <button
                  type="button"
                  aria-label={t.clientApp.habits.deleteHabit}
                  title={t.clientApp.habits.deleteHabit}
                  onClick={() => { setRemoveError(null); setConfirming(confirming === habit.id ? null : habit.id); }}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink-faint hover:bg-risk-soft hover:text-risk"
                >
                  <NavIcon d={CLOSE} className="h-[15px] w-[15px]" />
                </button>
              ) : null}
            </div>
            {confirming === habit.id ? (
              <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-risk-soft px-3.5 py-2.5">
                <p className="text-[13px] font-semibold text-risk">{t.clientApp.habits.deleteConfirm}</p>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setConfirming(null)}
                    className="inline-flex h-9 items-center rounded-full px-3.5 text-[12.5px] font-semibold text-ink-soft hover:text-ink"
                  >
                    {t.common.actions.cancel}
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        const r = await archiveHabit(habit.id);
                        if (!r.ok) { setRemoveError(r.message ?? t.clientApp.habits.couldNotDelete); return; }
                        setConfirming(null);
                        router.refresh();
                      })
                    }
                    className="inline-flex h-9 items-center rounded-full bg-risk px-3.5 text-[12.5px] font-bold text-accent-fg disabled:opacity-50"
                  >
                    {t.common.actions.delete}
                  </button>
                </div>
                {removeError ? <p className="basis-full text-[12px] text-risk">{removeError}</p> : null}
              </div>
            ) : null}
            {info && showing ? (
              <div className="ml-9 mt-1.5 rounded-2xl bg-bg px-3.5 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
                  {t.clientApp.habits.what}
                </p>
                <p className="mt-0.5 text-[13px] leading-relaxed text-ink-soft">{info.what}</p>
                <p className="mt-2.5 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
                  {t.clientApp.habits.why}
                </p>
                <p className="mt-0.5 text-[13px] leading-relaxed text-ink-soft">{info.why}</p>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
