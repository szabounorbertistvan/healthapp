"use client";
import { portionMacros } from "@healthapp/shared";
import { portionsFor, type DemoFood } from "@/lib/demo-foods";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";

/**
 * What a scan returns: the product, its nutrition, and where the numbers came
 * from. Shown before anything is logged — someone scanning a packet usually
 * wants to know what is in it, and only sometimes wants to log it.
 */
export function ProductCard({
  food,
  barcode,
  onLog,
  onRescan,
  busy = false,
}: {
  food: DemoFood;
  barcode: string;
  onLog: () => void;
  onRescan: () => void;
  busy?: boolean;
}) {
  const { t } = useI18n();
  const portions = portionsFor(food);
  const serving = portions[0] ?? null;
  const servingMacros = serving ? portionMacros(food.per_100g, serving.grams) : null;
  const name = food.name_ro || food.name_en;

  return (
    <div className="rounded-lg border border-line">
      <div className="border-b border-line p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-bold leading-tight">{name}</p>
            {food.brand ? <p className="mt-0.5 text-xs text-ink-soft">{food.brand}</p> : null}
            <p className="mt-1 font-mono text-[11px] text-ink-faint">{barcode}</p>
          </div>
          <button
            type="button"
            onClick={onRescan}
            className="shrink-0 text-xs font-semibold text-ink-faint hover:text-accent-ink"
          >
            {t.clientWidgets.productCard.scanAgain}
          </button>
        </div>
      </div>

      <div className="p-3">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
          {t.clientWidgets.productCard.per100g}
        </p>
        <div className="mt-1.5 grid grid-cols-4 gap-2">
          <Nutrient label="kcal" value={food.per_100g.kcal} accent />
          <Nutrient label={t.common.macros.protein} value={food.per_100g.protein} unit="g" />
          <Nutrient label={t.common.macros.carbs} value={food.per_100g.carbs} unit="g" />
          <Nutrient label={t.common.macros.fat} value={food.per_100g.fat} unit="g" />
        </div>

        {serving && servingMacros ? (
          <>
            <p className="mt-3 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
              {fill(t.clientWidgets.productCard.perServing, { label: serving.label, grams: serving.grams })}
            </p>
            <div className="mt-1.5 grid grid-cols-4 gap-2">
              <Nutrient label="kcal" value={servingMacros.kcal} accent />
              <Nutrient label={t.common.macros.protein} value={servingMacros.protein} unit="g" />
              <Nutrient label={t.common.macros.carbs} value={servingMacros.carbs} unit="g" />
              <Nutrient label={t.common.macros.fat} value={servingMacros.fat} unit="g" />
            </div>
            {serving.note ? (
              <p className="mt-1.5 text-[11px] leading-snug text-ink-faint">{serving.note}</p>
            ) : null}
          </>
        ) : (
          <p className="mt-3 text-[11px] leading-snug text-ink-faint">
            {t.clientWidgets.productCard.noServing}
          </p>
        )}

        <button
          type="button"
          disabled={busy}
          onClick={onLog}
          className="mt-4 w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-fg disabled:opacity-40"
        >
          {t.clientWidgets.productCard.logThis}
        </button>
      </div>
    </div>
  );
}

function Nutrient({
  label,
  value,
  unit = "",
  accent = false,
}: {
  label: string;
  value: number;
  unit?: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-md bg-bg p-2 text-center">
      <p className={`text-base font-bold tabular-nums ${accent ? "text-accent-ink" : ""}`}>
        {Math.round(value * 10) / 10}
        {unit}
      </p>
      <p className="text-[10px] uppercase tracking-wider text-ink-faint">{label}</p>
    </div>
  );
}
