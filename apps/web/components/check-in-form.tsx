"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitCheckIn } from "@/app/client-actions-app";
import { useI18n } from "@/lib/i18n/client";
import { Card } from "./ui";

const SCALES = ["sleep", "energy", "stress", "hunger", "recovery"] as const;

type ScaleKey = (typeof SCALES)[number];

export function CheckInForm() {
  const { t } = useI18n();
  const router = useRouter();
  const [weight, setWeight] = useState("");
  const [scores, setScores] = useState<Record<ScaleKey, number>>({
    sleep: 5,
    energy: 5,
    stress: 5,
    hunger: 5,
    recovery: 5,
  });
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <Card>
      <div className="space-y-4">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
            {t.clientWidgets.checkInForm.weightKg}
          </span>
          <input
            inputMode="decimal"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            placeholder={t.clientWidgets.checkInForm.optional}
            className="w-32 rounded-lg border border-line bg-surface px-3 py-2 text-sm tabular-nums outline-none focus:border-accent"
          />
        </label>

        {SCALES.map((scale) => (
          <div key={scale}>
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-semibold">{t.clientWidgets.checkInForm.scales[scale]}</span>
              <span className="text-sm font-bold tabular-nums text-accent-ink">
                {scores[scale]}
              </span>
            </div>
            <input
              type="range"
              min={1}
              max={10}
              value={scores[scale]}
              onChange={(e) =>
                setScores((prev) => ({ ...prev, [scale]: Number(e.target.value) }))
              }
              className="mt-1 w-full accent-[var(--color-accent)]"
            />
          </div>
        ))}

        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
            {t.clientWidgets.checkInForm.coachNote}
          </span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            className="w-full resize-y rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </label>

        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const parsed = parseFloat(weight);
              const result = await submitCheckIn({
                weightKg: weight.trim() === "" || !Number.isFinite(parsed) ? null : parsed,
                ...scores,
                note,
              });
              if (!result.ok) {
                setError(result.message ?? t.clientWidgets.checkInForm.couldNotSubmit);
                return;
              }
              router.refresh();
            })
          }
          className="w-full rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
        >
          {t.clientWidgets.checkInForm.submit}
        </button>

        {error ? <p className="text-sm font-semibold text-risk">{error}</p> : null}
      </div>
    </Card>
  );
}
