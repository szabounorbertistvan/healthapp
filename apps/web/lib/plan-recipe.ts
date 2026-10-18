// The recipe a planned meal links to (20261204100000), as both plan reads embed
// it: the coach's builder (lib/data.ts) and the client's day (lib/client-nutrition.ts).
// Pure — no server-only imports — so components and tests can share the shape.
// Both reads embed, inside planned_meals(...):
//   recipe_id, recipe:recipes(id, title, servings, serving_grams, prep_minutes, cook_minutes, steps, recipe_ingredients(position, label, grams))

/** What a planned meal shows of its recipe: enough to cook it, nothing that is costed. */
export type PlanRecipe = {
  id: string;
  title: string;
  servings: number;
  serving_grams: number;
  prep_minutes: number | null;
  cook_minutes: number | null;
  steps: string[];
  /** The recipe's lines as written ("500 g orez"), in order, with grams when known. */
  lines: { label: string; grams: number | null }[];
};

export type PlanRecipeJoin = {
  id: string; title: string; servings: number | string; serving_grams: number | string;
  prep_minutes: number | null; cook_minutes: number | null; steps: string[] | null;
  recipe_ingredients: { position: number; label: string; grams: number | string | null }[] | null;
} | null;

/**
 * The linked recipe, or how it is missing: "none" (no link), or "unavailable" —
 * a link the reader cannot follow (not readable to them under RLS). A deleted
 * recipe unlinks itself (on delete set null), so it reads as "none".
 */
export function toPlanRecipe(recipeId: string | null, join: PlanRecipeJoin): PlanRecipe | "none" | "unavailable" {
  if (!recipeId) return "none";
  if (!join) return "unavailable";
  return {
    id: join.id,
    title: join.title,
    servings: Number(join.servings),
    serving_grams: Number(join.serving_grams),
    prep_minutes: join.prep_minutes ?? null,
    cook_minutes: join.cook_minutes ?? null,
    steps: Array.isArray(join.steps) ? join.steps : [],
    lines: [...(join.recipe_ingredients ?? [])]
      .sort((a, b) => a.position - b.position)
      .map((l) => ({ label: l.label, grams: l.grams === null ? null : Number(l.grams) })),
  };
}
