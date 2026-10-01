// Outbound links into DishFinder's recipe finder, the sibling product
// (docs/DISHFINDER.md). DishFinder's /cooking page reads its whole filter state
// from the query string, so each button is a plain link — no API call, no shared
// database, no auth handoff, and DishFinder being down costs nothing but a dead
// tab.
//
// Two questions, two buttons (relu, 2026-10-01):
//   * "What can I cook with what's in my plan?"  → the meal's ingredients, ranked
//     by how many a recipe uses; no nutrient limits, the person weighs what they
//     plate and logs it here.
//   * "What else could I eat instead?"            → no ingredients at all, only
//     the meal's calorie/protein band; a recipe serving that lands in it is the
//     same meal as numbers, cooked from different food. Still "the coach sets the
//     target, the client picks the method": nothing about the plan changes, and
//     the real macros reach the log because the client cooks and weighs.
// Only recipes, on purpose: a restaurant dish changes the grams the plan shows,
// and could not be weighed, so there is no restaurant link.
//
// What crosses the origin is the ingredient list or the band and nothing else:
// no user, plan or coach id. The user taps; nothing opens on its own.
//
// Nothing renders without NEXT_PUBLIC_DISHFINDER_URL, and the links additionally
// need NEXT_PUBLIC_DISHFINDER_RECIPES=1, because DishFinder keeps public recipe
// reads behind a kill switch (ENABLE_PUBLIC_RECIPES) and a link to a 503 is
// worse than no link.

export type DishFinderFood = {
  /** `foods.dishfinder_ingredient_id`; a meal with any food lacking one gets no ingredients link. */
  dishfinder_id?: number | null;
  name: string;
};

/** The planned meal's totals, as the card already sums them. */
export type MealTotals = { kcal: number; protein: number };

const BASE = (process.env.NEXT_PUBLIC_DISHFINDER_URL ?? "").replace(/\/+$/, "");
const RECIPES_ON = process.env.NEXT_PUBLIC_DISHFINDER_RECIPES === "1";
const enabled = () => BASE.length > 0 && RECIPES_ON;

/**
 * "Recipes with these ingredients". Null when there is nothing honest to link:
 * not configured, an empty meal, or **any** food without a DishFinder
 * counterpart — a link built from three of four ingredients would search for a
 * different meal than the coach wrote, so it is all or nothing. DishFinder's
 * `ingredients` param wants `[{id, name}]` with a numeric id; it resolves the
 * labels to its own names on load, so `name` here is only a fallback.
 *
 * match=best: ranked by how many of these ingredients a recipe uses instead of
 * requiring all — whey protein is in no recipe at all, and "oats + milk +
 * banana + whey" strictly is zero results, while "3 of 4" is eighteen breakfasts.
 * ref=voinic: logged with the search, so DishFinder's admin Insights can tell a
 * plan-driven miss from an organic one. A source tag, nothing about who clicked.
 */
export function dishfinderIngredientsUrl(foods: DishFinderFood[]): string | null {
  if (!enabled() || foods.length === 0) return null;
  if (foods.some((f) => !f.dishfinder_id)) return null;
  const seen = new Set<number>();
  const ingredients: { id: number; name: string }[] = [];
  for (const f of foods) {
    const id = f.dishfinder_id as number;
    if (seen.has(id)) continue;
    seen.add(id);
    ingredients.push({ id, name: f.name });
  }
  const params = new URLSearchParams({ ingredients: JSON.stringify(ingredients), match: "best", ref: "voinic" });
  return `${BASE}/cooking?${params}`;
}

/**
 * The band for "recipes with the same macros": a serving within ±15 % of the
 * meal's calories that brings at least 85 % of its protein. Tighter than a
 * combined search could afford, because nothing else narrows it — on the live
 * corpus that is still thousands of recipes. Carbs and fat stay free on
 * purpose: they are where recipes legitimately differ (rice vs. potatoes), and
 * two more hard limits would turn most searches into zero. Rounded to the
 * sliders' steps (25 kcal, 5 g) so the controls land on a tick and the person
 * can nudge them from there.
 */
export function mealNutrientBand(meal: MealTotals): Record<string, string> {
  const band: Record<string, string> = {};
  if (meal.kcal >= 100) {
    band.minCalories = String(Math.max(0, Math.floor((meal.kcal * 0.85) / 25) * 25));
    band.maxCalories = String(Math.ceil((meal.kcal * 1.15) / 25) * 25);
  }
  if (meal.protein >= 10) band.minProtein = String(Math.floor((meal.protein * 0.85) / 5) * 5);
  return band;
}

/**
 * "Recipes with the same macros". Null when not configured or the meal is too
 * small to have a meaningful band (a 60 kcal snack is not a search).
 * ref=voinic-macros so the two buttons can be told apart in Insights.
 */
export function dishfinderMacrosUrl(meal: MealTotals): string | null {
  if (!enabled()) return null;
  const band = mealNutrientBand(meal);
  if (!band.maxCalories) return null;
  const params = new URLSearchParams({ ...band, ref: "voinic-macros" });
  return `${BASE}/cooking?${params}`;
}
