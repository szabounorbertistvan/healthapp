import { normalizeForSearch, type Macros } from "@healthapp/shared";

// Serving sizes for foods bought by the piece rather than weighed, plus the
// shape of a food row as the pickers see it.
//
// Both used to live in lib/demo-foods.ts next to a hand-written staples table.
// The staples went with demo mode; these did not — `portionsFor` is what puts
// the "M / L / 1 slice" chips under the gram box in the food logger, the
// product card and the nutrition builder, and it runs against rows from the
// `foods` table.

export type FoodPortion = {
  /** Chip label, kept short: "M", "1 slice". */
  label: string;
  grams: number;
  /** Shown on hover — says where the number comes from. */
  note: string;
};

export type FoodItem = {
  id: string;
  name_en: string;
  name_ro: string;
  group: string;
  per_100g: Macros;
  /** Manufacturer, for branded products from Open Food Facts. */
  brand?: string | null;
  /** Servings carried on the row itself, when the source provided them. */
  portions?: FoodPortion[];
  /**
   * True when the row has no Romanian name yet (the USDA import is English
   * only until an admin translates it). The pickers show a small "EN" mark.
   */
  english_only?: boolean;
};

// Foods bought by the piece, not weighed. Egg grades are the EU scale, and the
// grams are EDIBLE weight: the shell is about 11% of a graded egg and nobody
// eats it, so an EU "large" (63-73 g in the box) logs as ~58 g.
//
// Keyed by food id, with a keyword fallback for rows that arrive
// from Open Food Facts with ids this table has never seen.
const PORTIONS: Record<string, FoodPortion[]> = {
  egg: [
    { label: "S", grams: 44, note: "small, under 53 g with shell" },
    { label: "M", grams: 50, note: "medium, 53-63 g with shell" },
    { label: "L", grams: 58, note: "large, 63-73 g with shell" },
    { label: "XL", grams: 66, note: "very large, over 73 g with shell" },
  ],
  "egg-white": [
    { label: "S", grams: 28, note: "white of a small egg" },
    { label: "M", grams: 33, note: "white of a medium egg" },
    { label: "L", grams: 38, note: "white of a large egg" },
  ],
  banana: [
    { label: "S", grams: 90, note: "small, peeled" },
    { label: "M", grams: 118, note: "medium, peeled" },
    { label: "L", grams: 136, note: "large, peeled" },
  ],
  apple: [
    { label: "S", grams: 105, note: "small, cored" },
    { label: "M", grams: 138, note: "medium, cored" },
    { label: "L", grams: 172, note: "large, cored" },
  ],
  orange: [
    { label: "S", grams: 96, note: "small, peeled" },
    { label: "M", grams: 131, note: "medium, peeled" },
    { label: "L", grams: 184, note: "large, peeled" },
  ],
  "bread-wholegrain": [
    { label: "1 slice", grams: 35, note: "standard sandwich slice" },
    { label: "2 slices", grams: 70, note: "two standard slices" },
  ],
  "peanut-butter": [
    { label: "1 tsp", grams: 6, note: "level teaspoon" },
    { label: "1 tbsp", grams: 16, note: "level tablespoon" },
  ],
  "olive-oil": [
    { label: "1 tsp", grams: 5, note: "level teaspoon" },
    { label: "1 tbsp", grams: 14, note: "level tablespoon" },
  ],
  "sunflower-oil": [
    { label: "1 tsp", grams: 5, note: "level teaspoon" },
    { label: "1 tbsp", grams: 14, note: "level tablespoon" },
  ],
  butter: [
    { label: "1 tsp", grams: 5, note: "level teaspoon" },
    { label: "1 tbsp", grams: 14, note: "level tablespoon" },
  ],
  avocado: [
    { label: "half", grams: 100, note: "half a medium avocado" },
    { label: "whole", grams: 200, note: "one medium avocado" },
  ],
};

// Matched against the food name when the id is unknown, so a live "Ou de gaina"
// or "Free range eggs" still offers sizes.
const KEYWORD_PORTIONS: { match: RegExp; key: string }[] = [
  // Order matters: "egg white" must be tested before the bare "egg".
  // Patterns run against already-normalised text, so no /i and no diacritics.
  { match: /\b(egg whites?|albus|albusuri)\b/, key: "egg-white" },
  { match: /\b(eggs?|ou|oua|oualor)\b/, key: "egg" },
  { match: /\b(bananas?|banana|banane)\b/, key: "banana" },
  { match: /\b(apples?|mar|mere)\b/, key: "apple" },
  { match: /\b(oranges?|portocala|portocale)\b/, key: "orange" },
  { match: /\b(bread|paine|painea)\b/, key: "bread-wholegrain" },
];

/**
 * Serving sizes for a food, or an empty list when it is only ever weighed.
 * Falls back to a keyword match so foods that did not come from this table
 * still get sizes where the name makes it obvious.
 */
export function portionsFor(food: {
  id: string;
  name_en: string;
  name_ro: string;
  portions?: FoodPortion[];
}): FoodPortion[] {
  // A row that carries its own servings wins: those are either curated in the
  // database or imported from this product's own label, both closer to the
  // truth than a keyword guess made here.
  if (food.portions && food.portions.length > 0) return food.portions;
  const byId = PORTIONS[food.id];
  if (byId) return byId;
  const haystack = normalizeForSearch(`${food.name_en} ${food.name_ro}`);
  const hit = KEYWORD_PORTIONS.find((entry) => entry.match.test(haystack));
  return hit ? PORTIONS[hit.key] : [];
}

/**
 * A planned or logged weight in everyday terms — "2 × M" eggs, "1 × slice" of
 * bread — when one of the food's own servings measures it. Grams stay the
 * stored, canonical quantity (every macro is costed from them); this is only
 * how they read.
 *
 * Never a guess: with no serving on the food, or none that divides the weight
 * into whole or half pieces within 8%, the answer is null and the caller shows
 * grams alone. Labels that already carry a count above one ("2 slices") are
 * skipped, so a count is never multiplied twice.
 */
export type PracticalQuantity = {
  /** 1, 1.5, 2 … */
  count: number;
  /** The serving's label without a leading "1 ": "M", "slice", "tbsp". */
  unit: string;
  /** count × the serving's grams. */
  grams: number;
  /** True when count × the serving equals the weight (±0.5 g); false for "≈". */
  exact: boolean;
  /** Where the serving's number comes from, e.g. "medium, 53-63 g with shell". */
  note: string;
  /** The serving is the eaten part of something with a shell, peel or core. */
  edible: boolean;
};

const MAX_PIECES = 20;

export function practicalQuantity(
  grams: number,
  portions: readonly { label: string; grams: number; note?: string }[],
): PracticalQuantity | null {
  if (!(grams > 0)) return null;
  let best: (PracticalQuantity & { error: number }) | null = null;
  for (const p of portions) {
    if (!(p.grams > 0) || !p.label) continue;
    const lead = /^(\d+(?:[.,]\d+)?)\s+(.+)$/.exec(p.label.trim());
    if (lead && Number(lead[1]!.replace(",", ".")) !== 1) continue;
    const unit = lead ? lead[2]! : p.label.trim();
    const note = p.note ?? "";
    const edible = /shell|peel|cored|coaj|cojit/i.test(note);

    const whole = Math.round(grams / p.grams);
    if (whole >= 1 && whole <= MAX_PIECES && Math.abs(whole * p.grams - grams) <= 0.5) {
      return { count: whole, unit, grams: Math.round(whole * p.grams * 10) / 10, exact: true, note, edible };
    }
    const half = Math.round((grams / p.grams) * 2) / 2;
    if (half < 0.5 || half > MAX_PIECES) continue;
    const error = Math.abs(half * p.grams - grams) / grams;
    if (error <= 0.08 && (!best || error < best.error)) {
      best = { count: half, unit, grams: Math.round(half * p.grams * 10) / 10, exact: false, note, edible, error };
    }
  }
  if (!best) return null;
  const { error: _error, ...rest } = best;
  return rest;
}

/** grams for `count` of a serving, to one decimal — what a piece picker writes. */
export function gramsForPieces(count: number, servingGrams: number): number {
  return Math.round(count * servingGrams * 10) / 10;
}
