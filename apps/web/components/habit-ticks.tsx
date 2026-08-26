"use client";
import { useTransition, useOptimistic } from "react";
import { toggleHabit } from "@/app/client-actions-app";
import type { ClientHabitRow } from "@/lib/types";

/**
 * Ticking a habit is the smallest, most-repeated action in the app, so it
 * updates optimistically — the checkbox must not wait on a round trip.
 */
export function HabitTicks({ habits }: { habits: ClientHabitRow[] }) {
  const [pending, startTransition] = useTransition();
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
      {rows.map((habit) => (
        <li key={habit.id}>
          <button
            type="button"
            onClick={() =>
              startTransition(async () => {
                toggleOptimistic(habit.id);
                await toggleHabit(habit.id);
              })
            }
            className="flex w-full items-center gap-3 rounded-lg px-1 py-1.5 text-left hover:bg-bg"
          >
            <span
              aria-hidden
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-xs font-black ${
                habit.done_today
                  ? "border-accent bg-accent text-white"
                  : "border-line text-transparent"
              }`}
            >
              ✓
            </span>
            <span className={`flex-1 text-sm ${habit.done_today ? "text-ink-faint line-through" : ""}`}>
              {habit.name}
            </span>
            <span className="shrink-0 text-xs tabular-nums text-ink-faint">
              {habit.done_this_week}/{habit.target_per_week}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
