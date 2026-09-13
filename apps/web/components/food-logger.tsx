"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { portionMacros } from "@healthapp/shared";
import { lookupBarcode, searchFoods } from "@/app/nutrition-actions";
import { logFood, toggleFavoriteFood } from "@/app/client-actions-app";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { portionsFor, type DemoFood } from "@/lib/demo-foods";
import { FOOD_GROUP_ICON, foodGroupOf } from "@/lib/food-groups";
import type { MealSlot, QuickFood, QuickFoods } from "@/lib/types";
import { BarcodeScanner } from "./barcode-scanner";
import { ProductCard } from "./product-card";

// In demo mode every food id is a slug the store keeps as-is; live, only a
// real foods.id survives (the server drops anything else), so a product that
// came straight from Open Food Facts is keyed by name. Mirrored here so the
// star state the client shows matches the row the server wrote.
const IS_DEMO = !process.env.NEXT_PUBLIC_SUPABASE_URL;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const storableId = (id: string | null | undefined): string | null => (id && (IS_DEMO || UUID_RE.test(id)) ? id : null);
const keyOf = (foodId: string | null, name: string) => foodId || `name:${name.trim().toLowerCase()}`;
const nameOf = (food: DemoFood) => food.name_ro || food.name_en;

function toDemoFood(q: QuickFood): DemoFood {
  return { id: q.food_id ?? "", name_en: q.name, name_ro: q.name, group: q.group ?? "", per_100g: q.per_100g, portions: q.portions };
}
function toQuick(food: DemoFood, lastGrams: number | null): QuickFood {
  return {
    food_id: storableId(food.id),
    name: nameOf(food),
    per_100g: food.per_100g,
    portions: food.portions,
    last_grams: lastGrams,
    favorite: true,
    group: food.group || null,
  };
}

/**
 * Search a food, set grams, log it — opened inside the meal it logs to, so the
 * slot is already decided (eat&track style). Before anything is typed the list
 * is the person's own shortcuts: starred foods, then what they logged last,
 * each one tap from being logged again at the same portion. Reuses the coach
 * builder search action so both surfaces hit one food source.
 */
export function FoodLogger({
  slot,
  day,
  quick,
  onClose,
}: {
  slot: MealSlot;
  /** yyyy-mm-dd being viewed; the log lands on that day, not on today. */
  day: string;
  /** Starred and recently logged foods, read once by the page. */
  quick: QuickFoods;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const fl = t.clientWidgets.foodLogger;
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
  // Stars flip optimistically; the server's list only replaces this on the
  // next full render, so the set here is the source of truth while open.
  const [favs, setFavs] = useState<QuickFood[]>(quick.favorites);
  const favKeys = new Set(favs.map((f) => keyOf(f.food_id, f.name)));
  const recent = quick.recent.filter((r) => !favKeys.has(keyOf(r.food_id, r.name)));

  useEffect(() => {
    const timer = setTimeout(() => {
      startTransition(async () => setResults(await searchFoods(q)));
    }, 200);
    return () => clearTimeout(timer);
  }, [q]);

  const gramsNum = parseFloat(grams);
  const portions = picked ? portionsFor(picked) : [];

  // A food sold by the piece opens on its middle size rather than 100 g, which
  // is a quantity nobody ever ate; a food logged before opens on that portion.
  function pick(food: DemoFood, lastGrams: number | null = null) {
    const sizes = portionsFor(food);
    setPicked(food);
    if (lastGrams !== null && lastGrams > 0) {
      setGrams(String(lastGrams));
    } else if (sizes.length > 0) {
      const medium = sizes.find((s) => s.label === "M") ?? sizes[Math.floor(sizes.length / 2)];
      setGrams(String(medium.grams));
    } else {
      setGrams("100");
    }
  }

  function toggleStar(food: DemoFood, lastGrams: number | null) {
    const foodId = storableId(food.id);
    const key = keyOf(foodId, nameOf(food));
    const was = favKeys.has(key);
    const without = (list: QuickFood[]) => list.filter((f) => keyOf(f.food_id, f.name) !== key);
    setFavs((prev) => (was ? without(prev) : [toQuick(food, lastGrams), ...without(prev)]));
    startTransition(async () => {
      setError(null);
      const result = await toggleFavoriteFood({ foodId, foodName: nameOf(food), per100g: food.per_100g });
      if (!result.ok) {
        setFavs((prev) => (was ? [toQuick(food, lastGrams), ...without(prev)] : without(prev)));
        setError(result.message ?? fl.couldNotFavorite);
        return;
      }
      router.refresh();
    });
  }

  const preview =
    picked && Number.isFinite(gramsNum) && gramsNum > 0
      ? portionMacros(picked.per_100g, gramsNum)
      : null;
  const showQuick = q.trim() === "" && (favs.length > 0 || recent.length > 0);

  /** "150 g · 248 kcal" for a food logged before, else the per-100 g figure. */
  const metaFor = (food: DemoFood, lastGrams: number | null) =>
    lastGrams !== null && lastGrams > 0
      ? `${lastGrams} g · ${portionMacros(food.per_100g, lastGrams).kcal} kcal`
      : `${food.per_100g.kcal} kcal/100 g`;

  const row = (food: DemoFood, lastGrams: number | null, keyPrefix: string) => (
    <FoodRow
      key={`${keyPrefix}-${food.id || nameOf(food)}`}
      food={food}
      meta={metaFor(food, lastGrams)}
      starred={favKeys.has(keyOf(storableId(food.id), nameOf(food)))}
      onPick={() => pick(food, lastGrams)}
      onStar={() => toggleStar(food, lastGrams)}
    />
  );

  return (
    <div className="mt-3 border-t border-line pt-3">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
          {fill(fl.addTo, { slot: fl.slots[slot] })}
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
            <p className="flex min-w-0 items-center gap-2 font-semibold">
              <GroupIcon food={picked} />
              <span className="min-w-0 truncate">{nameOf(picked)}</span>
            </p>
            <button
              type="button"
              onClick={() => setPicked(null)}
              className="shrink-0 text-xs font-semibold text-ink-faint hover:text-ink"
            >
              {fl.change}
            </button>
          </div>
          {portions.length > 0 ? (
            <div className="mt-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
                {fl.size}
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
                {fl.grams}
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
                  foodName: nameOf(picked),
                  grams: gramsNum,
                  per100g: picked.per_100g,
                  // Links the log to its foods row so a later portion edit
                  // re-costs from the unrounded per-100g basis.
                  foodId: picked.id || null,
                });
                if (!result.ok) {
                  setError(result.message ?? fl.couldNotLog);
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
            {fill(fl.addTo, { slot: fl.slots[slot] })}
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
                  ? fill(fl.scanNotFound, { code })
                  : result.reason === "invalid"
                    ? fl.scanInvalid
                    : fl.scanUnreachable,
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
              placeholder={fl.searchPlaceholder}
              className="min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <button
              type="button"
              onClick={() => {
                setScanError(null);
                setScanning(true);
              }}
              className="shrink-0 rounded-lg border border-line px-3 py-2 text-sm font-semibold hover:border-accent"
              aria-label={fl.scanBarcode}
            >
              {fl.scan}
            </button>
          </div>
          {scanError ? (
            <p className="mt-2 text-xs leading-snug text-warn">{scanError}</p>
          ) : null}
          {!showQuick && results.some((food) => food.english_only) ? (
            <p className="mt-2 text-[11px] leading-snug text-ink-faint">
              {fl.englishOnlyHint}
            </p>
          ) : null}

          {showQuick ? (
            // No inner scroll here: a short list that clips inside a card reads
            // as complete on a phone, and the missing rows are never found.
            <div className="mt-2 space-y-3">
              {favs.length > 0 ? (
                <section>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-accent-ink">★ {fl.favorites}</p>
                  <ul className="mt-1 divide-y divide-line">
                    {favs.map((f) => row(toDemoFood(f), f.last_grams, "fav"))}
                  </ul>
                </section>
              ) : null}
              {recent.length > 0 ? (
                <section>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">🕒 {fl.recent}</p>
                  <ul className="mt-1 divide-y divide-line">
                    {recent.map((r) => row(toDemoFood(r), r.last_grams, "recent"))}
                  </ul>
                </section>
              ) : null}
            </div>
          ) : (
            <ul className="mt-2 max-h-64 divide-y divide-line overflow-y-auto">
              {results.map((food) => row(food, null, "result"))}
              {results.length === 0 ? (
                <li className="py-3 text-sm text-ink-faint">{fl.noMatches}</li>
              ) : null}
            </ul>
          )}
        </>
      )}

      {error ? <p className="mt-2 text-sm font-semibold text-risk">{error}</p> : null}
    </div>
  );
}

/** The small group icon: the table's group when set, else a guess from the name. */
function GroupIcon({ food }: { food: DemoFood }) {
  const { t } = useI18n();
  const group = foodGroupOf(food);
  return (
    <span
      role="img"
      aria-label={t.clientWidgets.foodLogger.groups[group]}
      title={t.clientWidgets.foodLogger.groups[group]}
      className="w-6 shrink-0 text-center text-base leading-none"
    >
      {FOOD_GROUP_ICON[group]}
    </span>
  );
}

/**
 * One food in a list: icon, name, a right-aligned figure, and a star. Two
 * buttons side by side rather than one nested in the other — the star must
 * not pick the food, and a button inside a button is invalid HTML anyway.
 */
function FoodRow({ food, meta, starred, onPick, onStar }: {
  food: DemoFood;
  meta: string;
  starred: boolean;
  onPick: () => void;
  onStar: () => void;
}) {
  const { t } = useI18n();
  const fl = t.clientWidgets.foodLogger;
  return (
    <li className="flex items-center gap-1">
      <button
        type="button"
        onClick={onPick}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-1 py-2 text-left text-sm hover:bg-bg"
      >
        <GroupIcon food={food} />
        <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
          <span className="min-w-0 truncate">{nameOf(food)}</span>
          {food.english_only ? (
            <span
              className="shrink-0 rounded border border-line px-1 text-[9px] font-semibold uppercase tracking-wider text-ink-faint"
              title={fl.englishOnlyHint}
            >
              {fl.englishOnly}
            </span>
          ) : null}
        </span>
        <span className="shrink-0 text-xs tabular-nums text-ink-faint">{meta}</span>
      </button>
      <button
        type="button"
        onClick={onStar}
        aria-pressed={starred}
        aria-label={starred ? fl.unstar : fl.star}
        title={starred ? fl.unstar : fl.star}
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-lg leading-none ${
          starred ? "text-accent-ink hover:text-ink" : "text-ink-faint hover:text-accent-ink"
        }`}
      >
        {starred ? "★" : "☆"}
      </button>
    </li>
  );
}
