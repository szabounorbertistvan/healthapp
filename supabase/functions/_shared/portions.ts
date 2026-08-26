// Turning an Open Food Facts serving into something safe to store.
//
// OFF gives at most ONE serving per barcode, as free text (`serving_size`) plus
// a parsed number (`serving_quantity`). Both are crowd-sourced, so neither can
// be trusted without checking. Observed in the live API:
//
//   "60 g" / 60          fine
//   "1 egg (60 g)" / 60  fine, and the text makes a better label
//   "50g" / 50           fine
//   "100 g" / 100        NOT a serving — the per-100 g basis leaking into it
//   (absent)             ~18% of packaged goods, more for generic foods
//
// Anything that fails a check is dropped rather than guessed at: a missing
// serving shows the client a grams field, which is honest. A wrong one shows a
// confident number that silently misreports every meal logged from it.

export type Portion = {
  label: string;
  grams: number;
  note: string;
  origin: "imported";
};

/** Grams that are not eaten, by OFF category. Eggs are graded shell-on. */
const REFUSE: { tag: string; factor: number; note: string }[] = [
  { tag: "en:eggs", factor: 0.89, note: "shell removed" },
  { tag: "en:bananas", factor: 0.64, note: "peeled" },
  { tag: "en:oranges", factor: 0.73, note: "peeled" },
  { tag: "en:avocados", factor: 0.73, note: "stone and skin removed" },
];

type OffProduct = {
  serving_size?: unknown;
  serving_quantity?: unknown;
  product_quantity?: unknown;
  categories_tags?: unknown;
};

/**
 * At most one imported portion, or an empty array. Never throws — this runs
 * inside the cache-fill path and must not be able to fail a search.
 */
export function portionsFromOff(product: OffProduct): Portion[] {
  const grams = Number(product.serving_quantity);
  if (!Number.isFinite(grams) || grams <= 0) return [];

  // A "serving" of exactly 100 g is almost always the per-100 g basis copied
  // into the field rather than a real portion. Cheap to drop, and the false
  // negatives (genuinely 100 g servings) cost only a manual grams entry.
  if (grams === 100) return [];

  // Nothing edible weighs 2 kg per serving.
  if (grams > 2000) return [];

  // A serving cannot exceed the package it came in.
  const packageGrams = Number(product.product_quantity);
  if (Number.isFinite(packageGrams) && packageGrams > 0 && grams > packageGrams) return [];

  const tags = Array.isArray(product.categories_tags)
    ? (product.categories_tags as unknown[]).map(String)
    : [];
  const refuse = REFUSE.find((r) => tags.includes(r.tag));
  const edible = refuse ? Math.round(grams * refuse.factor) : Math.round(grams * 10) / 10;
  if (edible <= 0) return [];

  return [
    {
      label: labelFor(product.serving_size, edible),
      grams: edible,
      note: refuse
        ? `Open Food Facts serving ${grams} g, ${refuse.note}`
        : "serving size from Open Food Facts",
      origin: "imported",
    },
  ];
}

/**
 * Prefer the human text OFF carries ("1 egg", "2 biscuits") over a bare weight,
 * since that is what the person is actually holding. Falls back to the grams.
 */
function labelFor(servingSize: unknown, grams: number): string {
  const raw = typeof servingSize === "string" ? servingSize.trim() : "";
  if (raw) {
    // "1 egg (60 g)" -> "1 egg";  "60 g" -> ""  (a bare weight is no label)
    const beforeParen = raw.split("(")[0].trim();
    const withoutWeight = beforeParen.replace(/[\d.,]+\s*(g|gr|gram|grammes|ml|kg)\b/gi, "").trim();
    const cleaned = withoutWeight.replace(/[·,;:-]+$/, "").trim();
    if (cleaned.length >= 2 && cleaned.length <= 16) return cleaned;
  }
  return `${grams} g`;
}
