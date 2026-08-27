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
import { Card } from "./ui";
import { BarcodeScanner } from "./barcode-scanner";
import { ProductCard } from "./product-card";

const SLOTS: MealSlot[] = ["breakfast", "lunch", "dinner", "snack"];

/**
 * Search a food, set grams, log it. Reuses the coach builder search action so
 * both surfaces hit one food source — demo table now, Open Food Facts through
 * the edge function once a backend is connected.
 */
export function FoodLogger() {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<DemoFood[]>([]);
  const [picked, setPicked] = useState<DemoFood | null>(null);
  const [grams, setGrams] = useState("100");
  const [slot, setSlot] = useState<MealSlot>(defaultSlot());
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanned, setScanned] = useState<{ food: DemoFood; barcode: string } | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      startTransition(async () => setResults(await searchFoods(q)));
    }, 200);
    return () => clearTimeout(timer);
  }, [q, open]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-white hover:opacity-90"
      >
        {t.clientWidgets.foodLogger.logFood}
      </button>
    );
  }

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
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
          {t.clientWidgets.foodLogger.logFood}
        </p>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setPicked(null);
            setQ("");
          }}
          className="text-xs font-semibold text-ink-faint hover:text-ink"
        >
          {t.common.actions.close}
        </button>
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {SLOTS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSlot(s)}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold capitalize ${
              slot === s ? "bg-accent text-white" : "bg-bg text-ink-soft"
            }`}
          >
            {t.clientWidgets.foodLogger.slots[s]}
          </button>
        ))}
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
                        active ? "bg-accent text-white" : "bg-bg text-ink-soft hover:text-ink"
                      }`}
                    >
                      {portion.label}
                      <span className={`ml-1 font-normal ${active ? "text-white/80" : "text-ink-faint"}`}>
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
                  foodName: picked.name_ro || picked.name_en,
                  grams: gramsNum,
                  per100g: picked.per_100g,
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
            className="mt-3 w-full rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
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
    </Card>
  );
}

/** Guess the meal from the clock so the common case needs no tap. */
function defaultSlot(): MealSlot {
  const hour = new Date().getHours();
  if (hour < 11) return "breakfast";
  if (hour < 16) return "lunch";
  if (hour < 21) return "dinner";
  return "snack";
}
