"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addHabit } from "@/app/client-actions-app";
import { useI18n } from "@/lib/i18n/client";
import { Card } from "./ui";

export function AddHabitForm() {
  const { t } = useI18n();
  const router = useRouter();
  const [name, setName] = useState("");
  const [perWeek, setPerWeek] = useState("7");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <Card>
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
        {t.clientWidgets.addHabitForm.title}
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-48 flex-1 flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
            {t.clientWidgets.addHabitForm.name}
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t.clientWidgets.addHabitForm.namePlaceholder}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
            {t.clientWidgets.addHabitForm.daysPerWeek}
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
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const result = await addHabit(name, parseInt(perWeek, 10));
              if (!result.ok) {
                setError(result.message ?? t.clientWidgets.addHabitForm.couldNotAdd);
                return;
              }
              setName("");
              router.refresh();
            })
          }
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          {t.common.actions.add}
        </button>
      </div>
      {error ? <p className="mt-2 text-sm font-semibold text-risk">{error}</p> : null}
    </Card>
  );
}
