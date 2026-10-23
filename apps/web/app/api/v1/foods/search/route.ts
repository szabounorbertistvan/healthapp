import type { FoodItemV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { foodItem } from "@/lib/api/food";
import { searchFoods } from "@/app/nutrition-actions";

// Food search for the app (?q=) — the web's searchFoods(): search_foods(), its
// daily cap and the Open Food Facts top-up, unchanged.
export const dynamic = "force-dynamic";

export const GET = v1Route(async (request) => {
  const q = new URL(request.url).searchParams.get("q") ?? "";
  const foods = q.trim().length >= 2 ? await searchFoods(q) : [];
  return apiJson<FoodItemV1[]>(foods.map(foodItem));
});
