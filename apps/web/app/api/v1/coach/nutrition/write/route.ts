import type { WriteResultV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import {
  addExtraMeal,
  addMealDayVariant,
  addPlanFood,
  createNutritionPlan,
  publishNutritionPlan,
  removeExtraMeal,
  removeMealDayVariant,
  removePlanFood,
  renameExtraMeal,
  setMealRecipe,
  updatePlanFoodGrams,
} from "@/app/nutrition-actions";

// The coach's nutrition writes — the web's nutrition-actions, named by `op`:
// create (a template for a client), addFood / grams / removeFood in a meal,
// a weekday's own version of a meal and back, a linked recipe, extra meals on
// one weekday, publish. The actions validate and the policies decide, as on the web.
export const dynamic = "force-dynamic";

const str = (v: unknown) => (typeof v === "string" ? v : "");
type Slot = "breakfast" | "lunch" | "dinner" | "snack";
const SLOTS: Slot[] = ["breakfast", "lunch", "dinner", "snack"];
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : NaN);

export const POST = v1Route(async (request) => {
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b.op !== "string") return apiJson<WriteResultV1>({ ok: false, message: "invalid request" }, 400);
  const plan = str(b.planId);
  let result: { ok: boolean; message?: string; id?: string };
  switch (b.op) {
    case "create":
      result = await createNutritionPlan({
        name: str(b.name), clientId: str(b.clientId), clientName: str(b.clientName),
        kcal: num(b.kcal), protein: num(b.protein), carbs: num(b.carbs), fat: num(b.fat),
      });
      break;
    case "addFood":
      result = await addPlanFood({ planId: plan, mealId: str(b.mealId), foodId: str(b.foodId), grams: num(b.grams) });
      break;
    case "grams":
      result = await updatePlanFoodGrams(plan, str(b.rowId), num(b.grams));
      break;
    case "removeFood":
      result = await removePlanFood(plan, str(b.rowId));
      break;
    case "variant":
      result = await addMealDayVariant(plan, str(b.mealId), num(b.dayIndex), b.copyFoods !== false);
      break;
    case "removeVariant":
      result = await removeMealDayVariant(plan, str(b.mealId));
      break;
    case "recipe":
      result = await setMealRecipe(plan, str(b.mealId), typeof b.recipeId === "string" ? b.recipeId : null);
      break;
    case "addExtra":
      result = await addExtraMeal({ planId: plan, dayIndex: num(b.dayIndex), slot: SLOTS.includes(b.slot as Slot) ? (b.slot as Slot) : "snack", name: str(b.name) });
      break;
    case "renameExtra":
      result = await renameExtraMeal(plan, str(b.mealId), str(b.name));
      break;
    case "removeExtra":
      result = await removeExtraMeal(plan, str(b.mealId));
      break;
    case "publish":
      result = await publishNutritionPlan(plan);
      break;
    default:
      return apiJson<WriteResultV1>({ ok: false, message: "unknown op" }, 400);
  }
  return apiJson<WriteResultV1 & { id?: string }>({ ok: result.ok, message: result.message, id: result.id });
});
