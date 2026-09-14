"use client";
import { useState, useTransition, useOptimistic } from "react";
import { archiveHabit, toggleHabit } from "@/app/client-actions-app";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/client";
import { suggestionKeyForName } from "@/lib/habit-suggestions";
import type { ClientHabitRow } from "@/lib/types";

/**
 * Ticking a habit is the smallest, most-repeated action in the app, so it
 * updates optimistically — the checkbox must not wait on a round trip. A habit
 * that came from one of the suggestions keeps an ⓘ that unfolds what it is and
 * why it is worth doing.
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
    <ul className={`space-y-2 ${pending ? "opacity-70" : ""}`}>
      {rows.map((habit) => {
        const key = suggestionKeyForName(habit.name);
        const info = key ? t.clientWidgets.habitSuggestions[key] : null;
        const showing = openInfo === habit.id;
        return (
          <li key={habit.id}>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() =>
                  startTransition(async () => {
                    toggleOptimistic(habit.id);
                    await toggleHabit(habit.id);
                  })
                }
                className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-1 py-1.5 text-left hover:bg-bg"
              >
                <span
                  aria-hidden
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-xs font-black ${
                    habit.done_today
                      ? "border-accent bg-accent text-accent-fg"
                      : "border-line text-transparent"
                  }`}
                >
                  ✓
                </span>
                <span className={`flex-1 truncate text-sm ${habit.done_today ? "text-ink-faint line-through" : ""}`}>
                  {habit.name}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-ink-faint">
                  {habit.done_this_week}/{habit.target_per_week}
                </span>
              </button>
              {info ? (
                <button
                  type="button"
                  aria-expanded={showing}
                  aria-label={t.clientApp.habits.what}
                  onClick={() => setOpenInfo(showing ? null : habit.id)}
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
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
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-faint hover:bg-risk-soft hover:text-risk"
                >
                  ×
                </button>
              ) : null}
            </div>
            {confirming === habit.id ? (
              <div className="mt-1 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-risk bg-risk-soft px-3 py-2">
                <p className="text-sm font-semibold text-risk">{t.clientApp.habits.deleteConfirm}</p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setConfirming(null)} className="min-h-9 rounded-lg px-3 text-sm font-semibold text-ink-soft hover:text-ink">
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
                    className="min-h-9 rounded-lg bg-risk px-3 text-sm font-semibold text-accent-fg disabled:opacity-50"
                  >
                    {t.common.actions.delete}
                  </button>
                </div>
                {removeError ? <p className="basis-full text-xs text-risk">{removeError}</p> : null}
              </div>
            ) : null}
            {info && showing ? (
              <div className="ml-9 mt-1 rounded-lg bg-bg p-3 text-sm">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
                  {t.clientApp.habits.what}
                </p>
                <p className="mt-0.5 text-ink-soft">{info.what}</p>
                <p className="mt-2 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
                  {t.clientApp.habits.why}
                </p>
                <p className="mt-0.5 text-ink-soft">{info.why}</p>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
