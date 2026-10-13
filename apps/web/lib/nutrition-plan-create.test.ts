import { describe, expect, test } from "vitest";
import { createPlanWithMeals, defaultPlanMeals, PLAN_MEAL_SLOTS, type PlanCreateSteps } from "./nutrition-plan-create";

/** Steps that record what ran; each answers per the scenario. */
function steps(answers: { plan?: string | null; meals?: string | null; remove?: string | null } = {}) {
  const calls: string[] = [];
  const s: PlanCreateSteps = {
    insertPlan: async () => {
      calls.push("insertPlan");
      return answers.plan ? { id: null, error: answers.plan } : { id: "plan-1", error: null };
    },
    insertMeals: async (planId) => {
      calls.push(`insertMeals:${planId}`);
      return answers.meals ?? null;
    },
    deletePlan: async (planId) => {
      calls.push(`deletePlan:${planId}`);
      return answers.remove ?? null;
    },
  };
  return { s, calls };
}

describe("createPlanWithMeals", () => {
  test("plan then its slots: success carries the plan id, nothing is deleted", async () => {
    const { s, calls } = steps();
    expect(await createPlanWithMeals(s)).toEqual({ ok: true, id: "plan-1" });
    expect(calls).toEqual(["insertPlan", "insertMeals:plan-1"]);
  });

  test("a refused plan stops there: no slots are attempted", async () => {
    const { s, calls } = steps({ plan: "new row violates row-level security policy" });
    expect(await createPlanWithMeals(s)).toEqual({ ok: false, message: "new row violates row-level security policy" });
    expect(calls).toEqual(["insertPlan"]);
  });

  // The regression: the slot insert's result used to be ignored, so a failure
  // here still answered ok and sent the coach to a plan with no meals.
  test("failed slots are not a success: the plan is removed and the error reported", async () => {
    const { s, calls } = steps({ meals: "connection reset" });
    expect(await createPlanWithMeals(s)).toEqual({ ok: false, message: "connection reset" });
    expect(calls).toEqual(["insertPlan", "insertMeals:plan-1", "deletePlan:plan-1"]);
  });

  test("when the clean-up fails too, the leftover draft is named rather than hidden", async () => {
    const { s } = steps({ meals: "timeout", remove: "timeout" });
    expect(await createPlanWithMeals(s)).toEqual({ ok: false, message: "timeout", leftover: "plan-1" });
  });
});

describe("defaultPlanMeals", () => {
  test("the four slots, in order, named and positioned", () => {
    expect(defaultPlanMeals("p")).toEqual([
      { plan_id: "p", slot: "breakfast", name: "Breakfast", position: 0 },
      { plan_id: "p", slot: "lunch", name: "Lunch", position: 1 },
      { plan_id: "p", slot: "dinner", name: "Dinner", position: 2 },
      { plan_id: "p", slot: "snack", name: "Snack", position: 3 },
    ]);
    expect(PLAN_MEAL_SLOTS).toHaveLength(4);
  });
});
