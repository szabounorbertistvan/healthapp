// Reads for "My recipes" and the DishFinder import dialog (20261201100000).
import "server-only";
import { cookies } from "next/headers";
import { gramsFromQuantity, type Macros, type RecipeHandoff } from "@healthapp/shared";
import { liveUser } from "./supabase/server";
import { HANDOFF_COOKIE, verifyHandoffCookie, type HandoffResult } from "./recipe-handoff-server";

export type MyRecipe = {
  id: string;
  title: string;
  servings: number;
  serving_grams: number;
  per_serving: Macros;
  nutrition_source: "dishfinder" | "voinic";
  dishfinder_url: string | null;
  image_url: string | null;
  lines: { label: string; grams: number | null; food_name: string | null }[];
};

/** The signed-in person's recipes, newest first, with their lines. One query. */
export async function getMyRecipes(): Promise<MyRecipe[]> {
  const live = await liveUser();
  if (!live) return [];
  const { data } = await live.supabase
    .from("recipes")
    .select(`id, title, servings, serving_grams, kcal_serving, protein_serving, carbs_serving, fat_serving,
      nutrition_source, dishfinder_url, image_url,
      recipe_ingredients(position, label, grams, food:foods(name_ro, name_en))`)
    .eq("owner_id", live.userId)
    .order("updated_at", { ascending: false })
    .limit(300);
  type Row = {
    id: string; title: string; servings: number; serving_grams: number;
    kcal_serving: number; protein_serving: number; carbs_serving: number; fat_serving: number;
    nutrition_source: "dishfinder" | "voinic"; dishfinder_url: string | null; image_url: string | null;
    recipe_ingredients: { position: number; label: string; grams: number | null; food: { name_ro: string | null; name_en: string } | null }[];
  };
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id,
    title: r.title,
    servings: Number(r.servings),
    serving_grams: Number(r.serving_grams),
    per_serving: { kcal: Number(r.kcal_serving), protein: Number(r.protein_serving), carbs: Number(r.carbs_serving), fat: Number(r.fat_serving) },
    nutrition_source: r.nutrition_source,
    dishfinder_url: r.dishfinder_url,
    image_url: r.image_url,
    lines: [...r.recipe_ingredients]
      .sort((a, b) => a.position - b.position)
      .map((l) => ({ label: l.label, grams: l.grams === null ? null : Number(l.grams), food_name: l.food ? (l.food.name_ro ?? l.food.name_en) : null })),
  }));
}

/** The pending hand-off in the cookie, verified again (the dialog never trusts the receive step alone). */
export async function readPendingHandoff(): Promise<HandoffResult | null> {
  const value = (await cookies()).get(HANDOFF_COOKIE)?.value;
  return value ? verifyHandoffCookie(value) : null;
}

export type ProposalLine = {
  label: string;
  qty: string | null;
  df_id: number | null;
  grams: number | null;
  food: { id: string; name: string; per100: Macros } | null;
};

export type ImportProposal = {
  handoff: RecipeHandoff;
  lines: ProposalLine[];
  /** The person's recipes already saved from this DishFinder recipe: update one, or keep a copy. */
  existing: { id: string; title: string }[];
};

/** The dialog's starting point: each line with the Voinic food its DishFinder id points to, and grams when the quantity states them. */
export async function getImportProposal(handoff: RecipeHandoff): Promise<ImportProposal> {
  const live = await liveUser();
  const lines: ProposalLine[] = handoff.recipe.ingredients.map((i) => ({
    label: i.qty ? `${i.qty} ${i.name}` : i.name,
    qty: i.qty,
    df_id: i.df_id,
    grams: gramsFromQuantity(i.qty),
    food: null,
  }));
  if (!live) return { handoff, lines, existing: [] };
  const ids = [...new Set(handoff.recipe.ingredients.map((i) => i.df_id).filter((x): x is number => x !== null))];
  const [foods, existing] = await Promise.all([
    ids.length > 0 ? live.supabase.rpc("foods_by_dishfinder_ids", { p_ids: ids }) : Promise.resolve({ data: [] }),
    live.supabase.from("recipes").select("id, title").eq("owner_id", live.userId).eq("dishfinder_recipe_id", handoff.recipe.id),
  ]);
  type FoodRow = { id: string; dishfinder_ingredient_id: number; name_en: string; name_ro: string | null; kcal_100g: number; protein_100g: number; carbs_100g: number; fat_100g: number };
  // The RPC orders each id's foods best-first (Romanian-named, verified, shortest name): keep the first.
  const best = new Map<number, FoodRow>();
  for (const f of ((foods as { data: FoodRow[] | null }).data ?? [])) if (!best.has(f.dishfinder_ingredient_id)) best.set(f.dishfinder_ingredient_id, f);
  for (const l of lines) {
    const f = l.df_id !== null ? best.get(l.df_id) : undefined;
    if (f) l.food = { id: f.id, name: f.name_ro ?? f.name_en, per100: { kcal: Number(f.kcal_100g), protein: Number(f.protein_100g), carbs: Number(f.carbs_100g), fat: Number(f.fat_100g) } };
  }
  return { handoff, lines, existing: ((existing.data ?? []) as { id: string; title: string }[]) };
}
