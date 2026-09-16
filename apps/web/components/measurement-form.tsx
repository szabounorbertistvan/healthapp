"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { displayToCm, displayToKg, parseDecimal } from "@healthapp/shared";
import { addMeasurement } from "@/app/client-actions-app";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { useUnits } from "@/lib/units/client";
import { Card } from "./ui";
import { NavIcon } from "./client-nav";

export function MeasurementForm() {
  const { t } = useI18n();
  const u = useUnits();
  const router = useRouter();
  const [weight, setWeight] = useState("");
  const [waist, setWaist] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  // As typed: 21,25 and 21.25 are both 21.25, and nothing is rounded on the way
  // to the row. The unit conversion happens after parsing and before the write,
  // because the column is metric whatever the person typed in.
  const parse = (v: string) => parseDecimal(v);

  return (
    <Card plain>
      <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
        <NavIcon d="M12 4a2 2 0 1 0 0 4 2 2 0 1 0 0-4M12 8v3M5 11h14l-2.5 9h-9zM8 14h8" className="h-[18px] w-[18px] text-accent-ink" />
        {t.clientWidgets.measurementForm.title}
      </p>
      <div className="mt-3.5 flex flex-wrap items-end gap-2.5">
        <label className="flex flex-col gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
            {fill(t.clientWidgets.measurementForm.weightKg, { unit: u.weightUnit })}
          </span>
          <input
            inputMode="decimal"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            className="w-24 rounded-xl border border-line bg-bg px-3 py-2.5 text-sm tabular-nums outline-none focus:border-accent"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
            {fill(t.clientWidgets.measurementForm.waistCm, { unit: u.lengthUnit })}
          </span>
          <input
            inputMode="decimal"
            value={waist}
            onChange={(e) => setWaist(e.target.value)}
            className="w-24 rounded-xl border border-line bg-bg px-3 py-2.5 text-sm tabular-nums outline-none focus:border-accent"
          />
        </label>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              setSaved(false);
              const typedWeight = parse(weight);
              const typedWaist = parse(waist);
              const result = await addMeasurement({
                weightKg: typedWeight === null ? null : displayToKg(typedWeight, u.weightUnit),
                waistCm: typedWaist === null ? null : displayToCm(typedWaist, u.lengthUnit),
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
          className="flex h-11 items-center justify-center rounded-2xl bg-accent px-5 font-display text-sm font-bold text-accent-fg hover:opacity-90 disabled:opacity-40"
        >
          {t.common.actions.save}
        </button>
      </div>
      {error ? <p className="mt-2.5 text-[13px] font-semibold text-risk">{error}</p> : null}
      {saved ? <p className="mt-2.5 text-[13px] font-semibold text-accent-ink">{t.clientWidgets.measurementForm.saved}</p> : null}
    </Card>
  );
}
