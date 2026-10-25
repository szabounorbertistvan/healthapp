import type { RecipeV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { getMyRecipes } from "@/lib/recipes-data";

// The person's recipes, newest first — the web's /recipes (owner-only by policy).
export const dynamic = "force-dynamic";

export const GET = v1Route(async () => apiJson<RecipeV1[]>(await getMyRecipes()));
