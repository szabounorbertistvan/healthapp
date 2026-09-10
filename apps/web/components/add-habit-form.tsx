"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addHabit } from "@/app/client-actions-app";
import { useI18n } from "@/lib/i18n/client";
import {
  HABIT_SUGGESTION_DAYS, HABIT_SUGGESTION_KEYS, suggestionKeyForName, type HabitSuggestionKey,
} from "@/lib/habit-suggestions";
import { Card } from "./ui";

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
    <Card className="space-y-4">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{m.ideas}</p>
        <p className="mt-0.5 text-xs text-ink-faint">{m.tapForDetails}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {HABIT_SUGGESTION_KEYS.map((key) => {
            const on = picked === key;
            const added = alreadyAdded.has(key);
            return (
              <button
                key={key}
                type="button"
                aria-pressed={on}
                onClick={() => setPicked(on ? null : key)}
                className={`rounded-md px-2.5 py-1.5 text-xs font-semibold ${
                  on
                    ? "bg-accent text-accent-fg"
                    : added
                      ? "bg-accent-soft text-accent-ink"
                      : "bg-bg text-ink-soft hover:text-ink"
                }`}
              >
                {added ? "✓ " : ""}
                {s[key].name}
              </button>
            );
          })}
        </div>

        {picked ? (
          <div className="mt-3 rounded-lg border border-line bg-bg p-3">
            <p className="font-semibold">{s[picked].name}</p>
            <p className="mt-2 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
              {t.clientApp.habits.what}
            </p>
            <p className="mt-0.5 text-sm text-ink-soft">{s[picked].what}</p>
            <p className="mt-2 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
              {t.clientApp.habits.why}
            </p>
            <p className="mt-0.5 text-sm text-ink-soft">{s[picked].why}</p>
            <div className="mt-3 flex items-center gap-3">
              <button
                type="button"
                disabled={pending || alreadyAdded.has(picked)}
                onClick={() => {
                  const key = picked;
                  add(s[key].name, HABIT_SUGGESTION_DAYS[key], () => setPicked(null));
                }}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg disabled:opacity-40"
              >
                {alreadyAdded.has(picked) ? t.clientApp.habits.added : m.addThis}
              </button>
              <span className="text-xs tabular-nums text-ink-faint">
                {HABIT_SUGGESTION_DAYS[picked]} {m.daysPerWeek}
              </span>
            </div>
          </div>
        ) : null}
      </div>

      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{m.custom}</p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-48 flex-1 flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">{m.name}</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={m.namePlaceholder}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
              {m.daysPerWeek}
            </span>
            <input
              inputMode="numeric"
              value={perWeek}
              onChange={(e) => setPerWeek(e.target.value)}
              className="w-20 rounded-lg border border-line bg-surface px-2 py-2 text-sm tabular-nums outline-none focus:border-accent"
            />
          </label>
          <button
            type="button"
            disabled={pending || !name.trim()}
            onClick={() => add(name, parseInt(perWeek, 10), () => setName(""))}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg disabled:opacity-40"
          >
            {t.common.actions.add}
          </button>
        </div>
      </div>
      {error ? <p className="text-sm font-semibold text-risk">{error}</p> : null}
    </Card>
  );
}
