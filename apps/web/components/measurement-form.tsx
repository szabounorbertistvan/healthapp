"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addMeasurement } from "@/app/client-actions-app";
import { useI18n } from "@/lib/i18n/client";
import { Card } from "./ui";

export function MeasurementForm() {
  const { t } = useI18n();
  const router = useRouter();
  const [weight, setWeight] = useState("");
  const [waist, setWaist] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const parse = (v: string) => {
    const n = parseFloat(v);
    return v.trim() === "" || !Number.isFinite(n) ? null : n;
  };

  return (
    <Card>
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
        {t.clientWidgets.measurementForm.title}
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
            {t.clientWidgets.measurementForm.weightKg}
          </span>
          <input
            inputMode="decimal"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            className="w-24 rounded-lg border border-line bg-surface px-2 py-2 text-sm tabular-nums outline-none focus:border-accent"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
            {t.clientWidgets.measurementForm.waistCm}
          </span>
          <input
            inputMode="decimal"
            value={waist}
            onChange={(e) => setWaist(e.target.value)}
            className="w-24 rounded-lg border border-line bg-surface px-2 py-2 text-sm tabular-nums outline-none focus:border-accent"
          />
        </label>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              setSaved(false);
              const result = await addMeasurement({
                weightKg: parse(weight),
                waistCm: parse(waist),
              });
              if (!result.ok) {
                setError(result.message ?? t.clientWidgets.measurementForm.couldNotSave);
                return;
              }
              setWeight("");
              setWaist("");
              setSaved(true);
              router.refresh();
            })
          }
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          {t.common.actions.save}
        </button>
      </div>
      {error ? <p className="mt-2 text-sm font-semibold text-risk">{error}</p> : null}
      {saved ? <p className="mt-2 text-sm text-accent-ink">{t.clientWidgets.measurementForm.saved}</p> : null}
    </Card>
  );
}
