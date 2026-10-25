import type { CoachPlanV1 } from "@healthapp/api/v1";
import { apiError, apiJson, v1Route } from "@/lib/api/v1";
import { planV1 } from "@/lib/api/nutrition";
import { canEdit } from "@/lib/can-edit";
import { getNutritionPlan } from "@/lib/data";
import { getPlan } from "@/lib/plan";

// One of the coach's nutrition plans — the web's /nutrition/[id]: targets, the
// meals (every day and per weekday) with their foods and grams, what each day
// adds up to, and whether it can still be edited (can_edit_nutrition_plan).
export const dynamic = "force-dynamic";

export const GET = v1Route(async (request) => {
  const id = decodeURIComponent(new URL(request.url).pathname.split("/").at(-1) ?? "");
  const [plan, access, tier] = await Promise.all([getNutritionPlan(id), canEdit("can_edit_nutrition_plan", { p_plan: id }), getPlan()]);
  if (!plan) return apiError("not_found", 404);
  return apiJson<CoachPlanV1>(planV1(plan, access === "edit" ? true : access === "read-only" ? false : null, tier.e.ingredientPlans));
});
