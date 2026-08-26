"use server";
import { revalidatePath } from "next/cache";
import { isDemo, supabaseServer } from "@/lib/supabase/server";
import { newId, store, type StoredPlan } from "@/lib/demo-store";
import { demoFoods, findDemoFoodByBarcode, searchDemoFoods, type DemoFood } from "@/lib/demo-foods";
import type { ActionResult } from "./actions";

// Nutrition plan builder writes (W6, Sprint 6).
//
// Same two-branch shape as the program builder. The Supabase branch is written
// to the schema but has not run against a live database yet.

export async function searchFoods(q: string): Promise<DemoFood[]> {
  if (isDemo) return searchDemoFoods(q).slice(0, 30);

  const supabase = await supabaseServer();
  let query = supabase
    .from("foods")
    .select("id, name_en, name_ro, brand, kcal_100g, protein_100g, carbs_100g, fat_100g, portions")
    .limit(30);
  if (q.trim()) {
    const safe = q.replace(/[,()%\\]/g, " ").trim();
    query = query.or(`name_en.ilike.%${safe}%,name_ro.ilike.%${safe}%`);
  }
  const { data } = await query;
  return (data ?? []).map((row) => ({
    id: row.id,
    name_en: row.name_en,
    name_ro: row.name_ro ?? row.name_en,
    group: "",
    brand: row.brand,
    per_100g: {
      kcal: row.kcal_100g,
      protein: row.protein_100g,
      carbs: row.carbs_100g,
      fat: row.fat_100g,
    },
    // Servings stored on the row: OFF imports plus any curated range. The
    // client falls back to its own table when this is empty.
    portions: (row.portions ?? []) as DemoFood["portions"],
  }));
}

export async function createNutritionPlan(input: {
  name: string;
  clientId: string;
  clientName: string;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}): Promise<ActionResult & { id?: string }> {
  const name = input.name.trim();
  if (!name) return { ok: false, message: "Give the plan a name" };
  if (input.kcal < 500 || input.kcal > 10000) {
    return { ok: false, message: "Daily calories must be between 500 and 10000" };
  }

  if (isDemo) {
    const plan: StoredPlan = {
      id: newId("n"),
      client_id: input.clientId,
      client_name: input.clientName,
      name,
      status: "draft",
      kcal_target: input.kcal,
      protein_target_g: input.protein,
      carbs_target_g: input.carbs,
      fat_target_g: input.fat,
      // The four slots from the spec, ready to fill.
      meals: [
        { id: newId("pm"), slot: "breakfast", name: "Breakfast", position: 0, foods: [] },
        { id: newId("pm"), slot: "lunch", name: "Lunch", position: 1, foods: [] },
        { id: newId("pm"), slot: "dinner", name: "Dinner", position: 2, foods: [] },
        { id: newId("pm"), slot: "snack", name: "Snack", position: 3, foods: [] },
      ],
    };
    store().plans.unshift(plan);
    revalidatePath("/nutrition");
    return { ok: true, demo: true, id: plan.id };
  }

  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, message: "Not signed in" };
  const { data, error } = await supabase
    .from("nutrition_plans")
    .insert({
      coach_id: auth.user.id,
      client_id: input.clientId,
      name,
      kcal_target: input.kcal,
      protein_target_g: input.protein,
      carbs_target_g: input.carbs,
      fat_target_g: input.fat,
      status: "draft",
    })
    .select("id")
    .single();
  if (error) return { ok: false, message: error.message };

  const slots = ["breakfast", "lunch", "dinner", "snack"] as const;
  await supabase.from("planned_meals").insert(
    slots.map((slot, position) => ({
      plan_id: data.id,
      slot,
      name: slot[0].toUpperCase() + slot.slice(1),
      position,
    })),
  );
  revalidatePath("/nutrition");
  return { ok: true, id: data.id };
}

export async function addPlanFood(input: {
  planId: string;
  mealId: string;
  foodId: string;
  grams: number;
}): Promise<ActionResult> {
  if (input.grams <= 0) return { ok: false, message: "Grams must be above zero" };

  if (isDemo) {
    const plan = find(input.planId);
    const meal = plan?.meals.find((m) => m.id === input.mealId);
    const food = demoFoods.find((f) => f.id === input.foodId);
    if (!plan || !meal || !food) return { ok: false, message: "Meal or food not found" };
    meal.foods.push({
      id: newId("pmf"),
      food_name: food.name_ro,
      grams: input.grams,
      per_100g: food.per_100g,
    });
    revalidatePath(`/nutrition/${input.planId}`);
    return { ok: true, demo: true };
  }

  const supabase = await supabaseServer();
  const { error } = await supabase.from("planned_meal_foods").insert({
    planned_meal_id: input.mealId,
    food_id: input.foodId,
    grams: input.grams,
  });
  if (error) return { ok: false, message: error.message };
  revalidatePath(`/nutrition/${input.planId}`);
  return { ok: true };
}

export async function updatePlanFoodGrams(
  planId: string,
  rowId: string,
  grams: number,
): Promise<ActionResult> {
  if (grams <= 0) return { ok: false, message: "Grams must be above zero" };

  if (isDemo) {
    const plan = find(planId);
    const row = plan?.meals.flatMap((m) => m.foods).find((f) => f.id === rowId);
    if (!plan || !row) return { ok: false, message: "Food not found" };
    row.grams = grams;
    revalidatePath(`/nutrition/${planId}`);
    return { ok: true, demo: true };
  }

  const supabase = await supabaseServer();
  const { error } = await supabase.from("planned_meal_foods").update({ grams }).eq("id", rowId);
  if (error) return { ok: false, message: error.message };
  revalidatePath(`/nutrition/${planId}`);
  return { ok: true };
}

export async function removePlanFood(planId: string, rowId: string): Promise<ActionResult> {
  if (isDemo) {
    const plan = find(planId);
    if (!plan) return { ok: false, message: "Plan not found" };
    for (const meal of plan.meals) {
      meal.foods = meal.foods.filter((f) => f.id !== rowId);
    }
    revalidatePath(`/nutrition/${planId}`);
    return { ok: true, demo: true };
  }

  const supabase = await supabaseServer();
  const { error } = await supabase.from("planned_meal_foods").delete().eq("id", rowId);
  if (error) return { ok: false, message: error.message };
  revalidatePath(`/nutrition/${planId}`);
  return { ok: true };
}

export async function publishNutritionPlan(planId: string): Promise<ActionResult> {
  if (isDemo) {
    const plan = find(planId);
    if (!plan) return { ok: false, message: "Plan not found" };
    if (plan.meals.every((m) => m.foods.length === 0)) {
      return { ok: false, message: "Add at least one food before publishing" };
    }
    plan.status = "published";
    revalidatePath(`/nutrition/${planId}`);
    revalidatePath("/nutrition");
    return { ok: true, demo: true };
  }

  const supabase = await supabaseServer();
  const { error } = await supabase
    .from("nutrition_plans")
    .update({ status: "published" })
    .eq("id", planId);
  if (error) return { ok: false, message: error.message };
  revalidatePath(`/nutrition/${planId}`);
  revalidatePath("/nutrition");
  return { ok: true };
}

function find(planId: string): StoredPlan | undefined {
  return store().plans.find((p) => p.id === planId);
}

export type BarcodeResult =
  | { ok: true; food: DemoFood }
  | { ok: false; reason: "invalid" | "not_found" | "upstream" };

/**
 * Resolve a scanned barcode to a food.
 *
 * Live mode checks the local `foods` cache first and only then calls the
 * barcode-lookup function, which hits Open Food Facts and caches the result —
 * so the second person to scan the same product pays nothing. A miss is not an
 * error: the caller falls back to search, because a scan must never dead-end
 * (PRODUCT_SPEC C3).
 */
export async function lookupBarcode(code: string): Promise<BarcodeResult> {
  const clean = code.trim();
  if (!/^\d{6,14}$/.test(clean)) return { ok: false, reason: "invalid" };

  if (isDemo) {
    const found = findDemoFoodByBarcode(clean);
    return found ? { ok: true, food: found } : { ok: false, reason: "not_found" };
  }

  const supabase = await supabaseServer();
  const { data: cached } = await supabase
    .from("foods")
    .select("id, name_en, name_ro, brand, kcal_100g, protein_100g, carbs_100g, fat_100g, portions")
    .eq("barcode", clean)
    .limit(1)
    .maybeSingle();
  if (cached) return { ok: true, food: toDemoFood(cached) };

  try {
    const { data, error } = await supabase.functions.invoke("barcode-lookup", {
      body: { code: clean },
    });
    if (error || !data?.food) return { ok: false, reason: "not_found" };
    return {
      ok: true,
      food: {
        id: data.food.food_id ?? clean,
        name_en: data.food.name,
        name_ro: data.food.name,
        group: "",
        brand: data.food.brand ?? null,
        per_100g: data.food.per_100g,
        portions: data.food.portions ?? [],
      },
    };
  } catch {
    return { ok: false, reason: "upstream" };
  }
}

type FoodRow = {
  id: string;
  name_en: string | null;
  name_ro: string | null;
  brand: string | null;
  kcal_100g: number;
  protein_100g: number;
  carbs_100g: number;
  fat_100g: number;
  portions?: unknown;
};

function toDemoFood(row: FoodRow): DemoFood {
  const name = row.name_ro ?? row.name_en ?? "—";
  return {
    id: row.id,
    name_en: row.name_en ?? name,
    name_ro: name,
    group: "",
    brand: row.brand ?? null,
    per_100g: {
      kcal: row.kcal_100g,
      protein: row.protein_100g,
      carbs: row.carbs_100g,
      fat: row.fat_100g,
    },
    portions: (row.portions ?? []) as DemoFood["portions"],
  };
}
