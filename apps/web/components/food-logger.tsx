"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { portionMacros } from "@healthapp/shared";
import { lookupBarcode, searchFoods } from "@/app/nutrition-actions";
import { logFood } from "@/app/client-actions-app";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { portionsFor, type DemoFood } from "@/lib/demo-foods";
import type { MealSlot } from "@/lib/types";
import { BarcodeScanner } from "./barcode-scanner";
import { ProductCard } from "./product-card";

/**
 * Search a food, set grams, log it — opened inside the meal it logs to, so the
 * slot is already decided (eat&track style). Reuses the coach builder search
 * action so both surfaces hit one food source — demo table now, Open Food
 * Facts through the edge function once a backend is connected.
 */
export function FoodLogger({
  slot,
  day,
  onClose,
}: {
  slot: MealSlot;
  /** yyyy-mm-dd being viewed; the log lands on that day, not on today. */
  day: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<DemoFood[]>([]);
  const [picked, setPicked] = useState<DemoFood | null>(null);
  const [grams, setGrams] = useState("100");
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanned, setScanned] = useState<{ food: DemoFood; barcode: string } | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const timer = setTimeout(() => {
      startTransition(async () => setResults(await searchFoods(q)));
    }, 200);
    return () => clearTimeout(timer);
  }, [q]);

  const gramsNum = parseFloat(grams);
  const portions = picked ? portionsFor(picked) : [];

  // A food sold by the piece opens on its middle size rather than 100 g, which
  // is a quantity nobody ever ate.
  function pick(food: DemoFood) {
    const sizes = portionsFor(food);
    setPicked(food);
    if (sizes.length > 0) {
      const medium = sizes.find((s) => s.label === "M") ?? sizes[Math.floor(sizes.length / 2)];
      setGrams(String(medium.grams));
    } else {
      setGrams("100");
    }
  }
  const preview =
    picked && Number.isFinite(gramsNum) && gramsNum > 0
      ? portionMacros(picked.per_100g, gramsNum)
      : null;

  return (
    <div className="mt-3 border-t border-line pt-3">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
          {fill(t.clientWidgets.foodLogger.addTo, { slot: t.clientWidgets.foodLogger.slots[slot] })}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="text-xs font-semibold text-ink-faint hover:text-ink"
        >
          {t.common.actions.close}
        </button>
      </div>

      {picked ? (
        <div className="rounded-lg border border-line p-3">
          <div className="flex items-start justify-between gap-2">
            <p className="font-semibold">{picked.name_ro || picked.name_en}</p>
            <button
              type="button"
              onClick={() => setPicked(null)}
              className="text-xs font-semibold text-ink-faint hover:text-ink"
            >
              {t.clientWidgets.foodLogger.change}
            </button>
          </div>
          {portions.length > 0 ? (
            <div className="mt-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
                {t.clientWidgets.foodLogger.size}
              </p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {portions.map((portion) => {
                  const active = gramsNum === portion.grams;
                  return (
                    <button
                      key={portion.label}
                      type="button"
                      title={portion.note}
                      onClick={() => setGrams(String(portion.grams))}
                      className={`rounded-md px-2.5 py-1.5 text-xs font-semibold ${
                        active ? "bg-accent text-accent-fg" : "bg-bg text-ink-soft hover:text-ink"
                      }`}
                    >
                      {portion.label}
                      <span className={`ml-1 font-normal ${active ? "text-accent-fg/70" : "text-ink-faint"}`}>
                        {portion.grams} g
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
                {t.clientWidgets.foodLogger.grams}
              </span>
              <input
                inputMode="decimal"
                value={grams}
                onChange={(e) => setGrams(e.target.value)}
                className="w-24 rounded-lg border border-line bg-surface px-2 py-2 text-sm tabular-nums outline-none focus:border-accent"
              />
            </label>
            {preview ? (
              <p className="pb-2 text-xs tabular-nums text-ink-faint">
                <b className="text-ink">{preview.kcal}</b> kcal · P{preview.protein} · C{preview.carbs} ·
                F{preview.fat}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            disabled={pending || !preview}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                const result = await logFood({
                  slot,
                  day,
                  foodName: picked.name_ro || picked.name_en,
                  grams: gramsNum,
                  per100g: picked.per_100g,
                  // Links the log to its foods row so a later portion edit
                  // re-costs from the unrounded per-100g basis.
                  foodId: picked.id,
                });
                if (!result.ok) {
                  setError(result.message ?? t.clientWidgets.foodLogger.couldNotLog);
                  return;
                }
                setPicked(null);
                setQ("");
                setGrams("100");
                router.refresh();
              })
            }
            className="mt-3 w-full rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg disabled:opacity-40"
          >
            {fill(t.clientWidgets.foodLogger.addTo, { slot: t.clientWidgets.foodLogger.slots[slot] })}
          </button>
        </div>
      ) : scanned ? (
        <ProductCard
          food={scanned.food}
          barcode={scanned.barcode}
          busy={pending}
          onRescan={() => {
            setScanned(null);
            setScanning(true);
          }}
          onLog={() => {
            pick(scanned.food);
            setScanned(null);
          }}
        />
      ) : scanning ? (
        <BarcodeScanner
          busy={pending}
          onCode={(code) =>
            startTransition(async () => {
              setScanError(null);
              const result = await lookupBarcode(code);
              if (result.ok) {
                // Show what the product is before anything is logged.
                setScanning(false);
                setScanned({ food: result.food, barcode: code });
                return;
              }
              // A scan must never dead-end: drop back to search with the code
              // shown, so the person can find the product by name instead.
              setScanning(false);
              setScanError(
                result.reason === "not_found"
                  ? fill(t.clientWidgets.foodLogger.scanNotFound, { code })
                  : result.reason === "invalid"
                    ? t.clientWidgets.foodLogger.scanInvalid
                    : t.clientWidgets.foodLogger.scanUnreachable,
              );
            })
          }
          onCancel={() => setScanning(false)}
        />
      ) : (
        <>
          <div className="flex gap-2">
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t.clientWidgets.foodLogger.searchPlaceholder}
              className="min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <button
              type="button"
              onClick={() => {
                setScanError(null);
                setScanning(true);
              }}
              className="shrink-0 rounded-lg border border-line px-3 py-2 text-sm font-semibold hover:border-accent"
              aria-label={t.clientWidgets.foodLogger.scanBarcode}
            >
              {t.clientWidgets.foodLogger.scan}
            </button>
          </div>
          {scanError ? (
            <p className="mt-2 text-xs leading-snug text-warn">{scanError}</p>
          ) : null}
          <ul className="mt-2 max-h-64 divide-y divide-line overflow-y-auto">
            {results.map((food) => (
              <li key={food.id}>
                <button
                  type="button"
                  onClick={() => pick(food)}
                  className="flex w-full items-baseline justify-between gap-3 px-1 py-2 text-left text-sm hover:bg-bg"
                >
                  <span className="min-w-0 truncate">{food.name_ro || food.name_en}</span>
                  <span className="shrink-0 text-xs tabular-nums text-ink-faint">
                    {food.per_100g.kcal} kcal/100 g
                  </span>
                </button>
              </li>
            ))}
            {results.length === 0 ? (
              <li className="py-3 text-sm text-ink-faint">{t.clientWidgets.foodLogger.noMatches}</li>
            ) : null}
          </ul>
        </>
      )}

      {error ? <p className="mt-2 text-sm font-semibold text-risk">{error}</p> : null}
    </div>
  );
}
