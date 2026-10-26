"use server";
import { type FoodItem } from "@/lib/food-portions";
import { revalidatePath } from "next/cache";
import { liveUser, supabaseServer } from "@/lib/supabase/server";
import { inserted, mutated } from "@/lib/supabase/mutate";
import { getI18n, getLocale } from "@/lib/i18n/server";
import { isPlanLimitError, isValidDailyTargets, MAX_EXTRA_MEALS_PER_DAY, MAX_KCAL_TARGET, MAX_MACRO_TARGET_G, MIN_KCAL_TARGET, nextExtraPosition } from "@healthapp/shared";
import type { ActionResult } from "./actions";
import { notSignedIn, upgradeRequired } from "@/lib/action-result";
import { getPlan } from "@/lib/plan";
import { createPlanWithMeals, defaultPlanMeals } from "@/lib/nutrition-plan-create";
import { z } from "zod";
import { id, num, parseInput, text } from "@/lib/validate";

// Nutrition plan builder writes (W6, Sprint 6).
//
// Same shape as the program builder. Driven against the live project on
// 2026-09-19 for addPlanFood / removePlanFood / publishNutritionPlan, with the
// client's read of the published plan checked on the other side; the grams,
// day-variant and create paths are still unverified. Every update/delete goes
// through `mutated()` so an RLS-filtered write cannot report success. See
// docs/superpowers/specs/2026-09-08-s1-*.
//
// Every export checks its arguments' shape first (lib/validate.ts) — these are
// public endpoints. The ranges with their own sentence stay in the actions.

const CreatePlanInput = z.object({
  name: text(),
  clientId: id,
  clientName: text(),
  kcal: num,
  protein: num,
  carbs: num,
  fat: num,
});

const NewFoodShape = z.object({
  name: text(),
  kcal: num,
  protein: num,
  carbs: num,
  fat: num,
  brand: text().nullish(),
  saturatedFat: num.nullish(),
  sugar: num.nullish(),
  salt: num.nullish(),
  barcode: text(32).nullish(),
  portions: z.array(z.object({ label: text(), grams: num })).max(20).nullish(),
});

/** How many foods one search returns — what the picker's scroll list holds. */
const FOOD_SEARCH_LIMIT = 60;

export async function searchFoods(q: string): Promise<FoodItem[]> {
  if (!text().safeParse(q).success) return [];
  const supabase = await supabaseServer();
  const term = q.trim();

  // The table is the primary source: it holds the USDA generic list, the
  // curated staples and every product ever scanned. It is read through
  // search_foods() (migration 20261019120000), never listed: the function
  // normalises the term the way `search_text` is stored (so "varza" finds
  // "Varză"), needs two characters, returns at most 60 rows with Romanian-named
  // ones first, hides other people's customs, and caps a user at 400 searches a
  // day — the shared library, and the Romanian names in it, cannot be pulled in
  // one call. The food-search function (Open Food Facts) only tops the list up
  // when the table is thin for this term.
  type SearchRow = {
    id: string; source: string; name_en: string; name_ro: string | null; brand: string | null;
    kcal_100g: number; protein_100g: number; carbs_100g: number; fat_100g: number;
    portions: FoodItem["portions"] | null;
  };
  const { data, error } = await supabase.rpc("search_foods", { p_q: term, p_limit: FOOD_SEARCH_LIMIT });
  if (error) {
    // Over the daily cap, or the function not deployed yet. An empty list is
    // the honest answer either way; the cause goes to the server log.
    console.warn(`[searchFoods] ${error.message}`);
    return [];
  }
  const local: FoodItem[] = ((data ?? []) as SearchRow[]).map((row) => ({
    id: row.id,
    name_en: row.name_en,
    name_ro: row.name_ro ?? row.name_en,
    // Only the USDA generic list is literally English. A scanned product with
    // no name_ro carries the name printed on its pack, whatever language.
    english_only: row.source === "usda" && row.name_ro == null,
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
  return [...local, ...remote.filter((f) => !seen.has(f.id))].slice(0, FOOD_SEARCH_LIMIT);
}

type RemoteFood = {
  food_id: string | null;
  /** Where the row came from; USDA rows without a Romanian name are the English-only ones. */
  external?: { source: string; id: string } | null;
  name: string;
  /** Present once the deployed function sends it; null means no Romanian name. */
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
        english_only: r.external?.source === "usda" && r.name_ro == null,
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
  const parsed = await parseInput(CreatePlanInput, input);
  if (!parsed.ok) return parsed.result;
  const name = input.name.trim();
  if (!name) return { ok: false, message: "Give the plan a name" };
  if (!Number.isInteger(input.kcal) || input.kcal < MIN_KCAL_TARGET || input.kcal > MAX_KCAL_TARGET) {
    return { ok: false, message: `Daily calories must be between ${MIN_KCAL_TARGET} and ${MAX_KCAL_TARGET}` };
  }
  // NaN (an emptied field) and negatives passed the kcal check above; macro
  // targets had no check at all, here or in the column.
  if (!isValidDailyTargets(input)) {
    return { ok: false, message: `Macro targets must be whole grams between 0 and ${MAX_MACRO_TARGET_G}` };
  }


  const live = await liveUser();
  if (!live) return notSignedIn;
  const { supabase, userId } = live;
  const outcome = await createPlanWithMeals({
    insertPlan: async () => {
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
      return error ? { id: null, error: error.message } : { id: data.id, error: null };
    },
    insertMeals: async (planId) =>
      (await supabase.from("planned_meals").insert(defaultPlanMeals(planId))).error?.message ?? null,
    // a draft: its author may delete it whatever has happened to the coaching since.
    // Zero rows is a failure too — RLS filters a delete without an error.
    deletePlan: async (planId) => {
      const { error, count } = await supabase.from("nutrition_plans").delete({ count: "exact" }).eq("id", planId);
      return error?.message ?? (count ? null : "NO_ROWS");
    },
  });
  if (!outcome.ok) {
    if (outcome.leftover) console.error("createNutritionPlan: a plan without meal slots was left behind", outcome.leftover);
    return { ok: false, message: outcome.message };
  }
  revalidatePath("/nutrition");
  return { ok: true, id: outcome.id };
}

export async function addPlanFood(input: {
  planId: string;
  mealId: string;
  foodId: string;
  grams: number;
}): Promise<ActionResult> {
  const parsed = await parseInput(z.object({ planId: id, mealId: id, foodId: id, grams: num }), input);
  if (!parsed.ok) return parsed.result;
  if (input.grams <= 0) return { ok: false, message: "Grams must be above zero" };
  const supabase = await supabaseServer();
  // Meals with real foods are Coach Pro for a coach's plan; a Starter plan is
  // its four targets. A person's own plan (coach_id null) is not coaching, so
  // the gate does not apply to it — the meal plan is theirs to fill.
  const { data: owner } = await supabase.from("nutrition_plans").select("coach_id").eq("id", input.planId).maybeSingle();
  if (owner?.coach_id !== null && !(await getPlan()).e.ingredientPlans) return upgradeRequired;

  const { error } = await supabase.from("planned_meal_foods").insert({
    planned_meal_id: input.mealId,
    food_id: input.foodId,
    grams: input.grams,
  });
  const refused = await inserted(error);
  if (refused) return refused;
  revalidatePath(`/nutrition/${input.planId}`);
  return { ok: true };
}

export async function updatePlanFoodGrams(
  planId: string,
  rowId: string,
  grams: number,
): Promise<ActionResult> {
  const parsed = await parseInput(z.tuple([id, id, num]), [planId, rowId, grams]);
  if (!parsed.ok) return parsed.result;
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
  const parsed = await parseInput(z.tuple([id, id]), [planId, rowId]);
  if (!parsed.ok) return parsed.result;
  const supabase = await supabaseServer();
  const failed = await mutated(
    await supabase.from("planned_meal_foods").delete({ count: "exact" }).eq("id", rowId),
  );
  if (failed) return failed;
  revalidatePath(`/nutrition/${planId}`);
  return { ok: true };
}

export async function publishNutritionPlan(planId: string): Promise<ActionResult> {
  const parsed = await parseInput(id, planId);
  if (!parsed.ok) return parsed.result;
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
  | { ok: false; reason: "invalid" | "not_found" | "upstream" | "limit" };

export type NewFoodInput = {
  name: string;
  /** Per 100 g, the basis the schema uses. */
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  brand?: string | null;
  /** Label nutrients per 100 g; null or absent = not on the label, never 0. */
  saturatedFat?: number | null;
  sugar?: number | null;
  salt?: number | null;
  /** The code that was scanned and missed, so the next scan finds this row. */
  barcode?: string | null;
  /** The person's own servings ("1 jar" = 400 g), shown as chips under the gram box. */
  portions?: { label: string; grams: number }[] | null;
};

export type CreateFoodResult = (ActionResult & { ok: true; food: FoodItem }) | (ActionResult & { ok: false });

/** foods.portions holds at most 8 entries (is_valid_food_portions). */
const MAX_FOOD_PORTIONS = 8;
/** The constraint's own ceiling for one serving. */
const MAX_FOOD_PORTION_GRAMS = 2000;

/**
 * Create a food the search does not have — a home dish, a local product, a
 * barcode Open Food Facts does not know. The row lands in `foods` with source
 * 'custom' and owner_id set (policy foods_custom_insert requires exactly that,
 * and foods_custom_write_scope keeps it so), which makes it searchable and
 * scannable for its owner only: search_foods() and food_by_barcode() hide other
 * people's customs. A coach in the plan builder and a client in the food logger
 * both call this; the created row comes back so the caller can log or add it
 * in the same motion.
 */
export async function createCustomFood(input: NewFoodInput): Promise<CreateFoodResult> {
  const parsed = await parseInput(NewFoodShape, input);
  if (!parsed.ok) return parsed.result as CreateFoodResult;
  const { t } = await getI18n();
  const m = t.clientWidgets.newFoodForm;
  const checked = customFoodRow(input, m);
  if ("invalid" in checked) return { ok: false, errorCode: "INVALID_INPUT", message: checked.invalid };

  const live = await liveUser();
  if (!live) return notSignedIn;
  const { supabase, userId } = live;
  const { data, error } = await supabase
    .from("foods")
    .insert({ source: "custom", owner_id: userId, ...checked.row })
    .select("id")
    .single();
  if (error) {
    console.error("createCustomFood failed:", error.message);
    return { ok: false, message: m.couldNotCreate };
  }
  return { ok: true, food: { ...checked.food, id: data.id } };
}

/**
 * Change one of the caller's own custom foods. Same checks as creating one.
 * History does not move: food_logs snapshot the macros at log time. A plan
 * that holds the food (the owner's own, or a coach's plan for a client) reads
 * the new numbers from now on — that is the point of correcting a label.
 * foods_custom_update pins owner, source and verified, and `mutated()` turns
 * someone else's id into an error rather than a silent success.
 */
export async function updateCustomFood(foodId: string, input: NewFoodInput): Promise<CreateFoodResult> {
  const parsedId = await parseInput(id, foodId);
  if (!parsedId.ok) return parsedId.result as CreateFoodResult;
  const parsed = await parseInput(NewFoodShape, input);
  if (!parsed.ok) return parsed.result as CreateFoodResult;
  const { t } = await getI18n();
  const m = t.clientWidgets.newFoodForm;
  const checked = customFoodRow(input, m);
  if ("invalid" in checked) return { ok: false, errorCode: "INVALID_INPUT", message: checked.invalid };

  const live = await liveUser();
  if (!live) return notSignedIn;
  const failed = await mutated(
    await live.supabase
      .from("foods")
      .update(checked.row, { count: "exact" })
      .eq("id", foodId)
      .eq("owner_id", live.userId)
      .eq("source", "custom"),
  );
  if (failed) return failed as CreateFoodResult;
  revalidatePath("/food/mine");
  return { ok: true, food: { ...checked.food, id: foodId } };
}

/**
 * Delete one of the caller's own custom foods. Diary entries keep their
 * snapshot (food_logs.food_id is set null), favourites and recipe lines let go
 * of it the same way; a meal plan line has no snapshot, so a food still in any
 * plan is refused (23503) with a sentence instead of a constraint name.
 */
export async function deleteCustomFood(foodId: string): Promise<ActionResult> {
  const parsed = await parseInput(id, foodId);
  if (!parsed.ok) return parsed.result;
  const live = await liveUser();
  if (!live) return notSignedIn;
  const result = await live.supabase
    .from("foods")
    .delete({ count: "exact" })
    .eq("id", foodId)
    .eq("owner_id", live.userId)
    .eq("source", "custom");
  if (result.error?.code === "23503") {
    const { t } = await getI18n();
    return { ok: false, message: t.clientApp.myFoods.inPlan };
  }
  const failed = await mutated(result);
  if (failed) return failed;
  revalidatePath("/food/mine");
  return { ok: true };
}

type CustomFoodRow = {
  name_en: string;
  name_ro: string;
  brand: string | null;
  barcode: string | null;
  kcal_100g: number;
  protein_100g: number;
  carbs_100g: number;
  fat_100g: number;
  saturated_fat_100g: number | null;
  sugar_100g: number | null;
  salt_100g: number | null;
  portions: { label: string; grams: number; note: string; origin: "curated" }[];
};

/** The checks a custom food passes before it is written, and the row it becomes. */
function customFoodRow(
  input: NewFoodInput,
  m: { nameRequired: string; macrosNegative: string; tooMuch: string; labelTooMuch: string; barcodeInvalid: string; portionInvalid: string },
): { invalid: string } | { row: CustomFoodRow; food: Omit<FoodItem, "id"> } {
  const name = input.name.trim();
  if (name.length < 2) return { invalid: m.nameRequired };
  const round = (v: number) => (Number.isFinite(v) && v >= 0 ? Math.round(v * 10) / 10 : NaN);
  const per_100g = { kcal: round(input.kcal), protein: round(input.protein), carbs: round(input.carbs), fat: round(input.fat) };
  if (Object.values(per_100g).some((v) => Number.isNaN(v))) return { invalid: m.macrosNegative };
  // 900 kcal is pure fat; three macros past 100 g (a little slack for label rounding) cannot fit in 100 g.
  if (per_100g.kcal > 900 || per_100g.protein + per_100g.carbs + per_100g.fat > 101) return { invalid: m.tooMuch };

  // Optional label nutrients: blank stays null ("not measured"), a value is a part of its macro.
  const optional = (v: number | null | undefined) => (v === null || v === undefined || Number.isNaN(v) ? null : round(v));
  const saturated = optional(input.saturatedFat);
  const sugar = optional(input.sugar);
  const salt = optional(input.salt);
  if ([saturated, sugar, salt].some((v) => Number.isNaN(v))) return { invalid: m.macrosNegative };
  if ((saturated ?? 0) > per_100g.fat || (sugar ?? 0) > per_100g.carbs || (salt ?? 0) > 100) return { invalid: m.labelTooMuch };

  const barcode = input.barcode?.trim() || null;
  if (barcode && !/^\d{6,14}$/.test(barcode)) return { invalid: m.barcodeInvalid };

  // Same shape the foods_portions_shape constraint enforces, checked here so
  // the person gets a sentence instead of a constraint name.
  const portions = (input.portions ?? [])
    .map((p) => ({ label: p.label.trim(), grams: Math.round(p.grams * 10) / 10 }))
    .filter((p) => p.label !== "" || Number.isFinite(p.grams));
  if (
    portions.length > MAX_FOOD_PORTIONS ||
    portions.some((p) => p.label.length < 1 || p.label.length > 16 || !Number.isFinite(p.grams) || p.grams <= 0 || p.grams > MAX_FOOD_PORTION_GRAMS)
  ) {
    return { invalid: m.portionInvalid };
  }
  const storedPortions = portions.map((p) => ({ label: p.label, grams: p.grams, note: "", origin: "curated" as const }));
  const brand = input.brand?.trim() || null;

  return {
    row: {
      // One name in both columns: a custom food is never part of the folded
      // English tail, whatever language it was typed in.
      name_en: name,
      name_ro: name,
      brand,
      barcode,
      kcal_100g: per_100g.kcal,
      protein_100g: per_100g.protein,
      carbs_100g: per_100g.carbs,
      fat_100g: per_100g.fat,
      saturated_fat_100g: saturated,
      sugar_100g: sugar,
      salt_100g: salt,
      portions: storedPortions,
    },
    food: {
      name_en: name,
      name_ro: name,
      group: "",
      brand,
      per_100g,
      portions: storedPortions.map(({ label, grams, note }) => ({ label, grams, note })),
    },
  };
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
  if (typeof code !== "string") return { ok: false, reason: "invalid" };
  const clean = code.trim();
  if (!/^\d{6,14}$/.test(clean)) return { ok: false, reason: "invalid" };


  const supabase = await supabaseServer();
  // The scan is counted against the plan's daily allowance in the same wave as
  // the cache read (claim_barcode_scan, migration 20260923120000). With the
  // paywall off it only counts. A failure other than the limit — the function
  // missing, the network — must not cost anyone a scan, so only the limit stops here.
  // food_by_barcode() instead of a table read: the library is no longer
  // listable (migration 20261019120000), only answerable one row at a time.
  const [claim, { data: cachedRows }] = await Promise.all([
    supabase.rpc("claim_barcode_scan"),
    supabase.rpc("food_by_barcode", { p_code: clean }),
  ]);
  if (isPlanLimitError(claim.error?.message)) return { ok: false, reason: "limit" };
  const cached = Array.isArray(cachedRows) ? cachedRows[0] : null;
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
 *
 * `copyFoods: false` is "replace on this day": the weekday gets the slot with
 * nothing in it, to be filled with a different meal, and the other six days
 * keep the everyday one.
 *
 * One version per slot and day: a second one would be invisible (mealsForWeekday
 * picks the first) yet still cost a row, so a double click must not make one.
 */
export async function addMealDayVariant(
  planId: string,
  mealId: string,
  dayIndex: number,
  copyFoods = true,
): Promise<ActionResult & { id?: string }> {
  const parsed = await parseInput(z.tuple([id, id, num, z.boolean()]), [planId, mealId, dayIndex, copyFoods]);
  if (!parsed.ok) return parsed.result;
  if (!Number.isInteger(dayIndex) || dayIndex < 1 || dayIndex > 7) {
    return { ok: false, message: "Pick a weekday" };
  }
  const supabase = await supabaseServer();

  const { data: source, error: readError } = await supabase
    .from("planned_meals")
    .select("slot, name, position, plan_id, extra, recipe_id, planned_meal_foods(food_id, grams)")
    .eq("id", mealId)
    .eq("plan_id", planId)
    .single();
  if (readError || !source) return { ok: false, message: readError?.message ?? "Meal not found" };
  // an extra meal already belongs to one day; it has no every-day version to vary
  if (source.extra) return { ok: false, errorCode: "INVALID_INPUT" };

  const { data: clash, error: clashError } = await supabase
    .from("planned_meals")
    .select("id")
    .eq("plan_id", planId)
    .eq("slot", source.slot)
    .eq("day_index", dayIndex)
    .eq("extra", false)
    .limit(1);
  if (clashError) return { ok: false, message: clashError.message };
  if ((clash ?? []).length > 0) return { ok: false, message: "That day already has its own version of this meal" };

  const { data: created, error } = await supabase
    .from("planned_meals")
    .insert({
      plan_id: planId,
      slot: source.slot,
      name: source.name,
      position: source.position,
      day_index: dayIndex,
      // the linked recipe travels with the copy; "start empty" is a different meal
      recipe_id: copyFoods ? source.recipe_id : null,
    })
    .select("id")
    .single();
  const refused = await inserted(error);
  if (refused) return refused;
  if (!created) return { ok: false };

  const foods = copyFoods ? ((source.planned_meal_foods ?? []) as { food_id: string; grams: number }[]) : [];
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
  const parsed = await parseInput(z.tuple([id, id]), [planId, mealId]);
  if (!parsed.ok) return parsed.result;
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

// ---------- linked recipes and extra meals (20261204100000) ----------

const PLAN_MEAL_NAME = z.string().max(60);

/** The guard's refusals in the editor's words; anything else as it came. */
async function planMealRefusal(message: string | undefined): Promise<ActionResult | null> {
  if (!message) return null;
  const m = (await getI18n()).t.coachWidgets.nutritionBuilder;
  if (message.includes("EXTRA_MEAL_LIMIT")) return { ok: false, errorCode: "INVALID_INPUT", message: m.extraLimit };
  if (message.includes("RECIPE_NOT_YOURS")) return { ok: false, errorCode: "INVALID_INPUT", message: m.recipeNotYours };
  return null;
}

/**
 * Link one of the editor's own recipes to a meal, or unlink it (null). A
 * reference only: the meal's foods and grams — what the day is costed from —
 * are not touched, so nothing is added twice. planned_meals_guard refuses a
 * recipe that is not the caller's.
 */
export async function setMealRecipe(planId: string, mealId: string, recipeId: string | null): Promise<ActionResult> {
  const parsed = await parseInput(z.tuple([id, id, id.nullable()]), [planId, mealId, recipeId]);
  if (!parsed.ok) return parsed.result;
  const supabase = await supabaseServer();
  const res = await supabase
    .from("planned_meals")
    .update({ recipe_id: recipeId }, { count: "exact" })
    .eq("id", mealId)
    .eq("plan_id", planId);
  const refused = await planMealRefusal(res.error?.message);
  if (refused) return refused;
  const failed = await mutated(res);
  if (failed) return failed;
  revalidatePath(`/nutrition/${planId}`);
  return { ok: true };
}

/**
 * A meal on top of one weekday's slot meals — a second snack, a pre-workout
 * meal. It exists on that day only; `slot` is the diary meal the client logs
 * it into. At most MAX_EXTRA_MEALS_PER_DAY a day (checked here for the
 * message, enforced by planned_meals_guard).
 */
export async function addExtraMeal(input: {
  planId: string;
  dayIndex: number;
  slot: "breakfast" | "lunch" | "dinner" | "snack";
  name: string;
}): Promise<ActionResult & { id?: string }> {
  const parsed = await parseInput(
    z.object({ planId: id, dayIndex: z.number().int().min(1).max(7), slot: z.enum(["breakfast", "lunch", "dinner", "snack"]), name: PLAN_MEAL_NAME }),
    input,
  );
  if (!parsed.ok) return parsed.result;
  const name = input.name.trim();
  const m = (await getI18n()).t.coachWidgets.nutritionBuilder;
  if (!name) return { ok: false, errorCode: "INVALID_INPUT", message: m.extraNameNeeded };
  const supabase = await supabaseServer();
  const { data: rows, error: readError } = await supabase
    .from("planned_meals")
    .select("day_index, position, extra")
    .eq("plan_id", input.planId)
    .eq("day_index", input.dayIndex)
    .eq("extra", true);
  if (readError) return { ok: false, message: readError.message };
  if ((rows ?? []).length >= MAX_EXTRA_MEALS_PER_DAY) return { ok: false, errorCode: "INVALID_INPUT", message: m.extraLimit };

  const { data, error } = await supabase
    .from("planned_meals")
    .insert({
      plan_id: input.planId,
      day_index: input.dayIndex,
      slot: input.slot,
      name,
      extra: true,
      position: nextExtraPosition(rows ?? [], input.dayIndex),
    })
    .select("id")
    .single();
  const limit = await planMealRefusal(error?.message);
  if (limit) return limit;
  const refused = await inserted(error);
  if (refused) return refused;
  revalidatePath(`/nutrition/${input.planId}`);
  return { ok: true, id: data?.id };
}

/** Rename an extra meal (the base slots keep their names). */
export async function renameExtraMeal(planId: string, mealId: string, name: string): Promise<ActionResult> {
  const parsed = await parseInput(z.tuple([id, id, PLAN_MEAL_NAME]), [planId, mealId, name]);
  if (!parsed.ok) return parsed.result;
  const clean = name.trim();
  if (!clean) return { ok: false, errorCode: "INVALID_INPUT", message: (await getI18n()).t.coachWidgets.nutritionBuilder.extraNameNeeded };
  const supabase = await supabaseServer();
  const failed = await mutated(
    await supabase
      .from("planned_meals")
      .update({ name: clean }, { count: "exact" })
      .eq("id", mealId)
      .eq("plan_id", planId)
      .eq("extra", true),
  );
  if (failed) return failed;
  revalidatePath(`/nutrition/${planId}`);
  return { ok: true };
}

/** Remove an extra meal and its foods. Only extras: a base slot meal is never deleted here. */
export async function removeExtraMeal(planId: string, mealId: string): Promise<ActionResult> {
  const parsed = await parseInput(z.tuple([id, id]), [planId, mealId]);
  if (!parsed.ok) return parsed.result;
  const supabase = await supabaseServer();
  const failed = await mutated(
    await supabase
      .from("planned_meals")
      .delete({ count: "exact" })
      .eq("id", mealId)
      .eq("plan_id", planId)
      .eq("extra", true),
  );
  if (failed) return failed;
  revalidatePath(`/nutrition/${planId}`);
  return { ok: true };
}

/**
 * A person's own meal plan (no coach): their targets plan (setMyNutritionTargets,
 * coach_id null) gets the four default meal slots, so the builder on /food/plan
 * has meals to fill. Idempotent — a plan that already has meals is left alone.
 * Written through the same policies as a coach's plan (can_edit_nutrition_plan
 * lets the solo owner write their own meals).
 */
export async function startMyMealPlan(): Promise<ActionResult & { id?: string }> {
  const live = await liveUser();
  if (!live) return notSignedIn;
  const { supabase, userId } = live;
  const { data: plan, error } = await supabase
    .from("nutrition_plans")
    .select("id, planned_meals(id)")
    .eq("client_id", userId)
    .is("coach_id", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return { ok: false, message: error.message };
  if (!plan) return { ok: false, errorCode: "INVALID_INPUT", message: (await getI18n()).t.clientApp.mealPlan.noTargets };
  if (((plan.planned_meals ?? []) as unknown[]).length === 0) {
    const { error: mealsError } = await supabase.from("planned_meals").insert(defaultPlanMeals(plan.id));
    const refused = await inserted(mealsError);
    if (refused) return refused;
  }
  revalidatePath("/food/plan");
  return { ok: true, id: plan.id };
}
