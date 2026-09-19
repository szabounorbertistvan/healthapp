"use server";
import { type FoodItem } from "@/lib/food-portions";
import { revalidatePath } from "next/cache";
import { liveUser, supabaseServer } from "@/lib/supabase/server";
import { mutated } from "@/lib/supabase/mutate";
import { getLocale } from "@/lib/i18n/server";
import { normalizeForSearch } from "@healthapp/shared";
import type { ActionResult } from "./actions";
import { notSignedIn } from "@/lib/action-result";

// Nutrition plan builder writes (W6, Sprint 6).
//
// Same shape as the program builder. Driven against the live project on
// 2026-09-19 for addPlanFood / removePlanFood / publishNutritionPlan, with the
// client's read of the published plan checked on the other side; the grams,
// day-variant and create paths are still unverified. Every update/delete goes
// through `mutated()` so an RLS-filtered write cannot report success. See
// docs/superpowers/specs/2026-09-08-s1-*.

export async function searchFoods(q: string): Promise<FoodItem[]> {
  const supabase = await supabaseServer();
  const term = q.trim();

  // The table is the primary source: it holds the USDA generic list, the
  // curated staples and every product ever scanned, and `search_text` makes
  // the match accent-insensitive. The food-search function (Open Food Facts)
  // only tops the list up when the table is thin for this term, so a barcode
  // product nobody has scanned yet can still be found by name.
  let query = supabase
    .from("foods")
    .select("id, name_en, name_ro, brand, kcal_100g, protein_100g, carbs_100g, fat_100g, portions")
    .order("verified", { ascending: false })
    .order("name_en")
    .limit(30);
  if (term) {
    // `search_text` is the lower-cased, unaccented name+brand kept by the
    // database (migration 20260908120000), and the term gets the same
    // treatment here, so "varza" finds "Varză" and "Paine" finds "Pâine".
    const safe = normalizeForSearch(term.replace(/[,()%\\]/g, " "));
    if (safe) query = query.ilike("search_text", `%${safe}%`);
  }
  const { data } = await query;
  const local: FoodItem[] = (data ?? []).map((row) => ({
    id: row.id,
    name_en: row.name_en,
    name_ro: row.name_ro ?? row.name_en,
    english_only: row.name_ro == null,
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
    portions: (row.portions ?? []) as FoodItem["portions"],
  }));

  if (term.length < 2 || local.length >= 10) return local;

  const remote = (await searchFoodsRemote(supabase, term)) ?? [];
  const seen = new Set(local.map((f) => f.id));
  return [...local, ...remote.filter((f) => !seen.has(f.id))].slice(0, 30);
}

type RemoteFood = {
  food_id: string | null;
  name: string;
  /** Present once the deployed function sends it; null means English only. */
  name_ro?: string | null;
  brand: string | null;
  per_100g: FoodItem["per_100g"];
};

/**
 * Ask the food-search function. `null` means the call itself failed (function
 * not deployed, network, no session) — distinct from an empty result — so the
 * caller can fall back to the local table instead of showing "no matches".
 */
async function searchFoodsRemote(
  supabase: Awaited<ReturnType<typeof supabaseServer>>,
  term: string,
): Promise<FoodItem[] | null> {
  const locale = await getLocale();
  try {
    // The deployed function reads its input from the query string, and
    // invoke() has no query option, so the parameters ride on the name.
    const params = new URLSearchParams({ q: term, locale });
    const { data, error } = await supabase.functions.invoke<{ results?: RemoteFood[] }>(
      `food-search?${params}`,
      { method: "GET" },
    );
    if (error || !Array.isArray(data?.results)) return null;
    return data.results
      // A hit that failed to cache has no uuid; plans and logs both key on one.
      .filter((r): r is RemoteFood & { food_id: string } => Boolean(r.food_id))
      .map((r) => ({
        id: r.food_id,
        name_en: r.name,
        name_ro: r.name_ro ?? r.name,
        english_only: r.name_ro == null,
        group: "",
        brand: r.brand ?? null,
        per_100g: r.per_100g,
        // The function does not return servings; the client falls back to its
        // own portion table for these.
        portions: [],
      }));
  } catch {
    return null;
  }
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


  const live = await liveUser();
  if (!live) return notSignedIn;
  const { supabase, userId } = live;
  const { data, error } = await supabase
    .from("nutrition_plans")
    .insert({
      coach_id: userId,
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


  const supabase = await supabaseServer();
  const failed = await mutated(
    await supabase.from("planned_meal_foods").update({ grams }, { count: "exact" }).eq("id", rowId),
  );
  if (failed) return failed;
  revalidatePath(`/nutrition/${planId}`);
  return { ok: true };
}

export async function removePlanFood(planId: string, rowId: string): Promise<ActionResult> {

  const supabase = await supabaseServer();
  const failed = await mutated(
    await supabase.from("planned_meal_foods").delete({ count: "exact" }).eq("id", rowId),
  );
  if (failed) return failed;
  revalidatePath(`/nutrition/${planId}`);
  return { ok: true };
}

export async function publishNutritionPlan(planId: string): Promise<ActionResult> {

  const supabase = await supabaseServer();
  const failed = await mutated(
    await supabase
      .from("nutrition_plans")
      .update({ status: "published" }, { count: "exact" })
      .eq("id", planId),
  );
  if (failed) return failed;
  revalidatePath(`/nutrition/${planId}`);
  revalidatePath("/nutrition");
  return { ok: true };
}


export type BarcodeResult =
  | { ok: true; food: FoodItem }
  | { ok: false; reason: "invalid" | "not_found" | "upstream" };

export type NewFoodInput = {
  name: string;
  /** Per 100 g, the basis the schema uses. */
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  brand?: string | null;
};

export type CreateFoodResult = { ok: true; food: FoodItem } | { ok: false; message: string };

/**
 * Create a food the search does not have — a home dish, a local product. The
 * row lands in `foods` with source 'custom' and owner_id set (policy
 * foods_custom_insert requires exactly that). A coach in the plan builder and
 * a client in the food logger both call this; the created row comes back so
 * the caller can log or add it in the same motion.
 */
export async function createCustomFood(input: NewFoodInput): Promise<CreateFoodResult> {
  const name = input.name.trim();
  if (name.length < 2) return { ok: false, message: "Give the food a name" };
  const num = (v: number) => (Number.isFinite(v) && v >= 0 ? Math.round(v * 10) / 10 : NaN);
  const per_100g = { kcal: num(input.kcal), protein: num(input.protein), carbs: num(input.carbs), fat: num(input.fat) };
  if (Object.values(per_100g).some((v) => Number.isNaN(v))) return { ok: false, message: "Macros must be zero or more" };
  if (per_100g.kcal > 900 || per_100g.protein > 100 || per_100g.carbs > 100 || per_100g.fat > 100) {
    return { ok: false, message: "Those values are more than 100 g can hold" };
  }
  const brand = input.brand?.trim() || null;

  const live = await liveUser();
  if (!live) return notSignedIn;
  const { supabase, userId } = live;
  const { data, error } = await supabase
    .from("foods")
    .insert({
      source: "custom",
      owner_id: userId,
      name_en: name,
      name_ro: name,
      brand,
      kcal_100g: per_100g.kcal,
      protein_100g: per_100g.protein,
      carbs_100g: per_100g.carbs,
      fat_100g: per_100g.fat,
    })
    .select("id")
    .single();
  if (error) return { ok: false, message: error.message };
  return { ok: true, food: { id: data.id, name_en: name, name_ro: name, group: "", brand, per_100g, portions: [] } };
}

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


  const supabase = await supabaseServer();
  const { data: cached } = await supabase
    .from("foods")
    .select("id, name_en, name_ro, brand, kcal_100g, protein_100g, carbs_100g, fat_100g, portions")
    .eq("barcode", clean)
    .limit(1)
    .maybeSingle();
  if (cached) return { ok: true, food: toFoodItem(cached) };

  try {
    const { data, error } = await supabase.functions.invoke("barcode-lookup", {
      body: { code: clean },
    });
    if (error) return { ok: false, reason: reasonFromFunctionError(error) };
    if (!data?.food) return { ok: false, reason: "not_found" };
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

/**
 * A non-2xx answer arrives as a FunctionsHttpError carrying the Response as
 * `context`. Only a 404 means the product is unknown. Anything else — 401 when
 * the session did not reach the function, 503 when Open Food Facts is down, a
 * relay failure with no status at all — is a problem on our side, and calling
 * it "not found" would send the person hunting for a product that exists.
 */
function reasonFromFunctionError(error: unknown): "invalid" | "not_found" | "upstream" {
  const status = (error as { context?: { status?: number } } | null)?.context?.status;
  if (status === 404) return "not_found";
  if (status === 400) return "invalid";
  return "upstream";
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

function toFoodItem(row: FoodRow): FoodItem {
  const name = row.name_ro ?? row.name_en ?? "—";
  return {
    id: row.id,
    name_en: row.name_en ?? name,
    name_ro: name,
    english_only: row.name_ro == null,
    group: "",
    brand: row.brand ?? null,
    per_100g: {
      kcal: row.kcal_100g,
      protein: row.protein_100g,
      carbs: row.carbs_100g,
      fat: row.fat_100g,
    },
    portions: (row.portions ?? []) as FoodItem["portions"],
  };
}

/**
 * Give one meal a weekday of its own.
 *
 * `planned_meals.day_index` has meant "0 = every day, 1..7 = that ISO weekday"
 * since the first nutrition migration and nothing ever wrote anything but 0, so
 * a plan was one day repeated for ever. This copies a meal — with its foods —
 * onto a specific weekday, leaving the everyday version untouched as the
 * fallback for the other six days.
 *
 * Copying rather than moving is deliberate: a coach who wants "Sunday is
 * different" still wants the default to keep applying Monday to Saturday, and
 * moving the only meal in a slot would empty six days to fill one.
 */
export async function addMealDayVariant(
  planId: string,
  mealId: string,
  dayIndex: number,
): Promise<ActionResult & { id?: string }> {
  if (!Number.isInteger(dayIndex) || dayIndex < 1 || dayIndex > 7) {
    return { ok: false, message: "Pick a weekday" };
  }
  const supabase = await supabaseServer();

  const { data: source, error: readError } = await supabase
    .from("planned_meals")
    .select("slot, name, position, plan_id, planned_meal_foods(food_id, grams)")
    .eq("id", mealId)
    .eq("plan_id", planId)
    .single();
  if (readError || !source) return { ok: false, message: readError?.message ?? "Meal not found" };

  const { data: created, error } = await supabase
    .from("planned_meals")
    .insert({
      plan_id: planId,
      slot: source.slot,
      name: source.name,
      position: source.position,
      day_index: dayIndex,
    })
    .select("id")
    .single();
  if (error) return { ok: false, message: error.message };

  const foods = (source.planned_meal_foods ?? []) as { food_id: string; grams: number }[];
  if (foods.length > 0) {
    const { error: foodError } = await supabase.from("planned_meal_foods").insert(
      foods.map((f) => ({ planned_meal_id: created.id, food_id: f.food_id, grams: f.grams })),
    );
    // The variant exists but is empty — say so rather than reporting success on
    // a meal the coach would then have to notice was blank.
    if (foodError) return { ok: false, message: foodError.message, id: created.id };
  }

  revalidatePath(`/nutrition/${planId}`);
  return { ok: true, id: created.id };
}

/** Drop a weekday variant. The everyday meal (day_index 0) is not deletable here. */
export async function removeMealDayVariant(planId: string, mealId: string): Promise<ActionResult> {
  const supabase = await supabaseServer();
  const failed = await mutated(
    await supabase
      .from("planned_meals")
      .delete({ count: "exact" })
      .eq("id", mealId)
      .eq("plan_id", planId)
      .neq("day_index", 0),
  );
  if (failed) return failed;
  revalidatePath(`/nutrition/${planId}`);
  return { ok: true };
}
