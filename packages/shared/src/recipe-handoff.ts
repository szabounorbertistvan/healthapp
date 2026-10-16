// The recipe hand-off from DishFinder: what its "Add to Voinic" button posts,
// how it is checked, and the arithmetic of the import dialog.
//
// The wire format (DishFinder builds it, Voinic verifies it — keep both sides equal):
//   p = base64url(JSON.stringify(RecipeHandoff))
//   s = base64url(HMAC-SHA256(secret, HANDOFF_CONTEXT + p))
// posted as a form (fields p, s) to <voinic>/recipes/receive. The signature is
// what makes the numbers trustworthy: the URL and the form are the visitor's
// to edit, the shared secret is not. Signing lives with each server (node:crypto
// here in apps/web/lib/recipe-handoff-server.ts); this module stays pure.
import { portionMacros, sumMacros, type Macros } from "./macros";

export const HANDOFF_CONTEXT = "voinic-recipe.v1.";
/** A hand-off older than this is refused: a copied link does not keep working. */
export const HANDOFF_MAX_AGE_S = 30 * 60;
/** Bigger than any real recipe, small enough to keep in a cookie across sign-in. */
export const HANDOFF_MAX_PAYLOAD = 3600;
export const HANDOFF_MAX_LINES = 60;

export type HandoffIngredient = {
  /** DishFinder ingredient id, when the line is one of its ingredients. */
  df_id: number | null;
  /** The ingredient's name as DishFinder shows it. */
  name: string;
  /** The quantity as written in the recipe, e.g. "1,5 kg" or "2 linguri". */
  qty: string | null;
};

export type RecipeHandoff = {
  v: 1;
  /** Issued at / expires at, unix seconds. */
  iat: number;
  exp: number;
  recipe: {
    id: number;
    title: string;
    url: string;
    image: string | null;
    /** Servings the recipe makes, as DishFinder states it. */
    servings: number;
    /** Nutrition of ONE serving, as DishFinder states it. */
    per_serving: Macros;
    ingredients: HandoffIngredient[];
  };
};

export type HandoffError = "HANDOFF_MALFORMED" | "HANDOFF_EXPIRED" | "HANDOFF_TOO_LARGE";

const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const isStr = (x: unknown, max: number): x is string => typeof x === "string" && x.trim().length > 0 && x.length <= max;
const https = (x: unknown) => typeof x === "string" && /^https:\/\/[^\s]{1,490}$/.test(x);

/**
 * The decoded payload, checked for shape and age — or why not. Run only on a
 * payload whose signature already verified; this is the second gate, not the first.
 */
export function parseHandoff(json: string, nowS: number): { ok: true; handoff: RecipeHandoff } | { ok: false; error: HandoffError } {
  if (json.length > HANDOFF_MAX_PAYLOAD * 2) return { ok: false, error: "HANDOFF_TOO_LARGE" };
  let raw: unknown;
  try { raw = JSON.parse(json); } catch { return { ok: false, error: "HANDOFF_MALFORMED" }; }
  const h = raw as RecipeHandoff;
  const r = h?.recipe;
  const m = r?.per_serving;
  const valid =
    h?.v === 1 && isNum(h.iat) && isNum(h.exp) && h.exp > h.iat &&
    r && Number.isInteger(r.id) && r.id > 0 && isStr(r.title, 160) && https(r.url) &&
    (r.image === null || https(r.image)) &&
    isNum(r.servings) && r.servings > 0 && r.servings <= 500 &&
    m && [m.kcal, m.protein, m.carbs, m.fat].every((x) => isNum(x) && x >= 0) && m.kcal <= 10000 &&
    Array.isArray(r.ingredients) && r.ingredients.length <= HANDOFF_MAX_LINES &&
    r.ingredients.every((i) =>
      i && isStr(i.name, 120) &&
      (i.df_id === null || (Number.isInteger(i.df_id) && i.df_id > 0)) &&
      (i.qty === null || (typeof i.qty === "string" && i.qty.length <= 60)));
  if (!valid) return { ok: false, error: "HANDOFF_MALFORMED" };
  if (nowS > h.exp || h.exp - h.iat > HANDOFF_MAX_AGE_S || h.iat > nowS + 60) return { ok: false, error: "HANDOFF_EXPIRED" };
  return { ok: true, handoff: h };
}

const UNIT_GRAMS: Record<string, number> = {
  g: 1, gr: 1, grame: 1, gram: 1, grams: 1,
  kg: 1000, kilogram: 1000, kilograme: 1000,
  ml: 1, l: 1000, litru: 1000, litri: 1000, liter: 1000, litre: 1000,
};

/**
 * Grams from a written quantity, when the quantity says them: "500 g", "1,5 kg",
 * "250ml" (water-like, 1 g/ml), "0.5 l". Anything else ("2 linguri", "1 ceapă",
 * "după gust") is null — the dialog asks instead of guessing.
 */
export function gramsFromQuantity(qty: string | null | undefined): number | null {
  if (!qty) return null;
  const m = qty.trim().toLowerCase().match(/^(?:aprox\.?\s*|~\s*)?(\d+(?:[.,]\d+)?)\s*([a-zăîâșț]+)\.?$/);
  if (!m) return null;
  const n = Number(m[1]!.replace(",", "."));
  const f = UNIT_GRAMS[m[2]!];
  if (!f || !(n > 0)) return null;
  const g = Math.round(n * f * 10) / 10;
  return g > 0 && g <= 20000 ? g : null;
}

export type DialogLine = {
  /** A matched Voinic food and its per-100 g values; null when the line has none. */
  food: { id: string; per100: Macros } | null;
  grams: number | null;
  include: boolean;
};

/** Total grams of the lines that state them — the basis of the proposed serving weight. */
export function linesGrams(lines: readonly DialogLine[]): number {
  return lines.reduce((s, l) => s + (l.include && l.grams ? l.grams : 0), 0);
}

/** A serving's proposed weight: the stated grams over the servings, or null when nothing states grams. */
export function proposedServingGrams(lines: readonly DialogLine[], servings: number): number | null {
  const total = linesGrams(lines);
  if (!(total > 0) || !(servings > 0)) return null;
  return Math.round((total / servings) * 10) / 10;
}

/**
 * One serving recomputed from the matched foods: every included line with a
 * food and grams, summed, over the servings. `missing` counts included lines
 * that could not count (no food or no grams), so the dialog can say so.
 */
export function recomputedServing(lines: readonly DialogLine[], servings: number): { macros: Macros; missing: number } {
  const counted = lines.filter((l) => l.include && l.food && l.grams && l.grams > 0);
  const missing = lines.filter((l) => l.include).length - counted.length;
  const total = sumMacros(counted.map((l) => portionMacros(l.food!.per100, l.grams!)));
  const k = servings > 0 ? 1 / servings : 0;
  const r1 = (x: number) => Math.round(x * k * 10) / 10;
  return { macros: { kcal: Math.round(total.kcal * k), protein: r1(total.protein), carbs: r1(total.carbs), fat: r1(total.fat) }, missing };
}

/** DishFinder's serving, rescaled when the person changes the number of servings (the pot stays the same). */
export function scaledServing(perServing: Macros, fromServings: number, toServings: number): Macros {
  const k = toServings > 0 ? fromServings / toServings : 1;
  const r1 = (x: number) => Math.round(x * k * 10) / 10;
  return { kcal: Math.round(perServing.kcal * k), protein: r1(perServing.protein), carbs: r1(perServing.carbs), fat: r1(perServing.fat) };
}
