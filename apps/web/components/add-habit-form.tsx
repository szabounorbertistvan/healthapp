"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addHabit } from "@/app/client-actions-app";
import { useI18n } from "@/lib/i18n/client";
import {
  HABIT_SUGGESTION_DAYS, HABIT_SUGGESTION_KEYS, suggestionKeyForName, type HabitSuggestionKey,
} from "@/lib/habit-suggestions";
import { Card } from "./ui";
import { NavIcon } from "./client-nav";

const CHECK = "m5 12 5 5 9-10";

/**
 * Two ways in: tap one of seven suggested habits (each opens a short "what" and
 * "why" before it is added), or write a custom one below.
 */
export function AddHabitForm({ existingNames }: { existingNames: string[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const m = t.clientWidgets.addHabitForm;
  const s = t.clientWidgets.habitSuggestions;
  const [picked, setPicked] = useState<HabitSuggestionKey | null>(null);
  const [name, setName] = useState("");
  const [perWeek, setPerWeek] = useState("7");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const alreadyAdded = new Set(
    existingNames.map((n) => suggestionKeyForName(n)).filter((k): k is HabitSuggestionKey => k !== null),
  );

  function add(habitName: string, days: number, after?: () => void) {
    startTransition(async () => {
      setError(null);
      const result = await addHabit(habitName, days);
      if (!result.ok) {
        setError(result.message ?? m.couldNotAdd);
        return;
      }
      after?.();
      router.refresh();
    });
  }

  return (
    <Card plain className="space-y-5">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{m.ideas}</p>
        <p className="mt-1 text-[12.5px] text-ink-faint">{m.tapForDetails}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {HABIT_SUGGESTION_KEYS.map((key) => {
            const on = picked === key;
            const added = alreadyAdded.has(key);
            return (
              <button
                key={key}
                type="button"
                aria-pressed={on}
                onClick={() => setPicked(on ? null : key)}
                className={`inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-semibold ${
                  on
                    ? "bg-accent text-accent-fg"
                    : added
                      ? "bg-accent-soft text-accent-ink"
                      : "bg-bg text-ink-soft hover:text-ink"
                }`}
              >
                {added ? <NavIcon d={CHECK} className="h-3.5 w-3.5 [stroke-width:2.6]" /> : null}
                {s[key].name}
              </button>
            );
          })}
        </div>

        {picked ? (
          <div className="mt-3.5 rounded-2xl bg-bg px-4 py-3.5">
            <p className="font-display text-[15px] font-bold tracking-tight">{s[picked].name}</p>
            <p className="mt-2.5 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
              {t.clientApp.habits.what}
            </p>
            <p className="mt-0.5 text-[13px] leading-relaxed text-ink-soft">{s[picked].what}</p>
            <p className="mt-2.5 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
              {t.clientApp.habits.why}
            </p>
            <p className="mt-0.5 text-[13px] leading-relaxed text-ink-soft">{s[picked].why}</p>
            <div className="mt-3.5 flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={pending || alreadyAdded.has(picked)}
                onClick={() => {
                  const key = picked;
                  add(s[key].name, HABIT_SUGGESTION_DAYS[key], () => setPicked(null));
                }}
                className="flex h-11 items-center justify-center rounded-2xl bg-accent px-5 font-display text-sm font-bold text-accent-fg hover:opacity-90 disabled:opacity-40"
              >
                {alreadyAdded.has(picked) ? t.clientApp.habits.added : m.addThis}
              </button>
              <span className="text-[12.5px] tabular-nums text-ink-faint">
                {HABIT_SUGGESTION_DAYS[picked]} {m.daysPerWeek}
              </span>
            </div>
          </div>
        ) : null}
      </div>

      <div>
        <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{m.custom}</p>
        <div className="flex flex-wrap items-end gap-2.5">
          <label className="flex min-w-48 flex-1 flex-col gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">{m.name}</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={m.namePlaceholder}
              className="w-full rounded-xl border border-line bg-bg px-3 py-2.5 text-sm outline-none placeholder:text-ink-faint focus:border-accent"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
              {m.daysPerWeek}
            </span>
            <input
              inputMode="numeric"
              value={perWeek}
              onChange={(e) => setPerWeek(e.target.value)}
              className="w-20 rounded-xl border border-line bg-bg px-3 py-2.5 text-sm tabular-nums outline-none focus:border-accent"
            />
          </label>
          <button
            type="button"
            disabled={pending || !name.trim()}
            onClick={() => add(name, parseInt(perWeek, 10), () => setName(""))}
            className="flex h-11 items-center justify-center rounded-2xl bg-accent px-5 font-display text-sm font-bold text-accent-fg hover:opacity-90 disabled:opacity-40"
          >
            {t.common.actions.add}
          </button>
        </div>
      </div>
      {error ? <p className="text-[13px] font-semibold text-risk">{error}</p> : null}
    </Card>
  );
}
