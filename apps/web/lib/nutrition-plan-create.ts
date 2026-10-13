/**
 * The steps of creating a nutrition plan: the plan row, then its four default
 * meal slots. PostgREST cannot insert both in one transaction, and a plan
 * without its slots is unusable — foods are only ever added to an existing
 * meal — so a failed slot insert removes the plan it was for and the action
 * reports the failure instead of sending the coach to an empty plan.
 *
 * Kept free of Next and Supabase imports so the orchestration is unit-tested
 * (nutrition-plan-create.test.ts); createNutritionPlan supplies the queries.
 */

export const PLAN_MEAL_SLOTS = ["breakfast", "lunch", "dinner", "snack"] as const;

export type PlanMealSlot = (typeof PLAN_MEAL_SLOTS)[number];

/** The rows the default slots insert, in order. */
export function defaultPlanMeals(planId: string) {
  return PLAN_MEAL_SLOTS.map((slot, position) => ({
    plan_id: planId,
    slot,
    name: slot[0]!.toUpperCase() + slot.slice(1),
    position,
  }));
}

/** Each step answers with an error message, or null when it worked. */
export type PlanCreateSteps = {
  insertPlan: () => Promise<{ id: string; error: null } | { id: null; error: string }>;
  insertMeals: (planId: string) => Promise<string | null>;
  deletePlan: (planId: string) => Promise<string | null>;
};

export type PlanCreateOutcome =
  | { ok: true; id: string }
  /** `leftover` names a plan that could not be cleaned up: a draft without slots. */
  | { ok: false; message: string; leftover?: string };

export async function createPlanWithMeals(steps: PlanCreateSteps): Promise<PlanCreateOutcome> {
  const plan = await steps.insertPlan();
  if (plan.error !== null) return { ok: false, message: plan.error };
  const mealsError = await steps.insertMeals(plan.id);
  if (mealsError === null) return { ok: true, id: plan.id };
  const deleteError = await steps.deletePlan(plan.id);
  return deleteError === null
    ? { ok: false, message: mealsError }
    : { ok: false, message: mealsError, leftover: plan.id };
}
