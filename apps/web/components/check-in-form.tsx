"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { parseDecimal } from "@healthapp/shared";
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
    <Card plain>
      <div className="space-y-5">
        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            {t.clientWidgets.checkInForm.weightKg}
          </span>
          <input
            inputMode="decimal"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            placeholder={t.clientWidgets.checkInForm.optional}
            className="mt-1.5 h-11 w-36 rounded-xl border border-line bg-bg px-3 text-sm tabular-nums outline-none focus:border-accent"
          />
        </label>

        {/* The five scales, each a label + its value + the slider under them. */}
        <div className="rounded-2xl bg-bg px-4 py-3.5">
          <div className="divide-y divide-line/60">
            {SCALES.map((scale) => (
              <div key={scale} className="py-2.5 first:pt-0 last:pb-0">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-semibold">{t.clientWidgets.checkInForm.scales[scale]}</span>
                  <span className="font-display text-base font-bold tabular-nums text-accent-ink">
                    {scores[scale]}
                  </span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={10}
                  value={scores[scale]}
                  aria-label={t.clientWidgets.checkInForm.scales[scale]}
                  onChange={(e) =>
                    setScores((prev) => ({ ...prev, [scale]: Number(e.target.value) }))
                  }
                  className="mt-2 w-full"
                />
              </div>
            ))}
          </div>
        </div>

        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            {t.clientWidgets.checkInForm.coachNote}
          </span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            className="mt-1.5 w-full resize-y rounded-xl border border-line bg-bg px-3 py-2.5 text-sm leading-relaxed outline-none focus:border-accent"
          />
        </label>

        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const parsed = parseDecimal(weight);
              const result = await submitCheckIn({
                weightKg: parsed,
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
          className="flex h-11 w-full items-center justify-center rounded-2xl bg-accent px-5 font-display text-sm font-bold text-accent-fg hover:opacity-90 disabled:opacity-40"
        >
          {t.clientWidgets.checkInForm.submit}
        </button>

        {error ? <p className="text-[13px] font-semibold text-risk">{error}</p> : null}
      </div>
    </Card>
  );
}
