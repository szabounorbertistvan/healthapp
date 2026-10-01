// Outbound link into DishFinder's recipe finder, the sibling product
// (docs/DISHFINDER.md). A planned meal is a list of ingredients; DishFinder's
// /cooking page reads its whole filter state from the query string, so "recipes
// with these ingredients" is a plain link — no API call, no shared database, no
// auth handoff, and DishFinder being down costs nothing but a dead tab.
//
// Only recipes, on purpose. "Cook what your coach prescribed" keeps the
// ingredients and changes the method; a restaurant dish changes the grams, and
// a link next to "160 g · 264 kcal" would read as "this is the same meal". It
// is not, so there is no restaurant link (relu, 2026-10-01).
//
// What crosses the origin is the ingredient list and nothing else: no user,
// plan or coach id. The user taps; nothing opens on its own.
//
// Nothing renders without NEXT_PUBLIC_DISHFINDER_URL, and the link additionally
// needs NEXT_PUBLIC_DISHFINDER_RECIPES=1, because DishFinder keeps public recipe
// reads behind a kill switch (ENABLE_PUBLIC_RECIPES) and a link to a 503 is
// worse than no link.

export type DishFinderFood = {
  /** `foods.dishfinder_ingredient_id`; a meal with any food lacking one gets no link. */
  dishfinder_id?: number | null;
  name: string;
};

const BASE = (process.env.NEXT_PUBLIC_DISHFINDER_URL ?? "").replace(/\/+$/, "");
const RECIPES_ON = process.env.NEXT_PUBLIC_DISHFINDER_RECIPES === "1";

/**
 * The recipes link for a meal, or null when there is nothing honest to link:
 * no deployment configured, recipes not public yet, an empty meal, or **any**
 * food without a DishFinder counterpart. A link built from three of four
 * ingredients would search for a different meal than the coach wrote, so it is
 * all or nothing. DishFinder's `ingredients` param wants `[{id, name}]` with a
 * numeric id; it resolves the labels to its own names on load, so `name` here
 * is only a fallback.
 */
export function dishfinderRecipesUrl(foods: DishFinderFood[]): string | null {
  if (!BASE || !RECIPES_ON || foods.length === 0) return null;
  if (foods.some((f) => !f.dishfinder_id)) return null;
  const seen = new Set<number>();
  const ingredients: { id: number; name: string }[] = [];
  for (const f of foods) {
    const id = f.dishfinder_id as number;
    if (seen.has(id)) continue;
    seen.add(id);
    ingredients.push({ id, name: f.name });
  }
  // match=best: DishFinder ranks recipes by how many of these ingredients they
  // use instead of requiring all of them. A plan's meal is not a recipe — whey
  // protein is in no recipe at all, and "oats + milk + banana + whey" strictly
  // is zero results, while "3 of 4" is eighteen breakfasts.
  // ref=voinic: DishFinder logs it with the search, so its admin Insights tab can
  // tell "a meal plan asked for this and we had no recipe" from organic misses.
  // A source tag, nothing about who clicked.
  const params = new URLSearchParams({ ingredients: JSON.stringify(ingredients), match: "best", ref: "voinic" });
  return `${BASE}/cooking?${params}`;
}
