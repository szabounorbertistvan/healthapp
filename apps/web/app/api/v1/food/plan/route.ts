import type { MyMealPlanV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { planV1 } from "@/lib/api/nutrition";
import { canEdit } from "@/lib/can-edit";
import { getMySoloPlan, hasActiveCoach } from "@/lib/client-data";
import { getNutritionPlan } from "@/lib/data";

// The person's own meal plan — the web's /food/plan. A coached person's plan is
// the coach's (said, not offered); writes go through /api/v1/coach/nutrition/write,
// whose actions do not gate a person's own plan (coach_id null).
export const dynamic = "force-dynamic";

export const GET = v1Route(async () => {
  const [coached, solo] = await Promise.all([hasActiveCoach(), getMySoloPlan()]);
  const [plan, access] = solo?.hasMeals && !coached
    ? await Promise.all([getNutritionPlan(solo.id), canEdit("can_edit_nutrition_plan", { p_plan: solo.id })])
    : [null, null];
  return apiJson<MyMealPlanV1>({
    coached,
    solo: solo ? { id: solo.id, has_meals: solo.hasMeals } : null,
    plan: plan ? planV1(plan, access === "edit" ? true : access === "read-only" ? false : null, true) : null,
  });
});
