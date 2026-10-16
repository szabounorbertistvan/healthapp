// createGoal (app/goal-actions.ts) lives under app/, which the node test glob
// does not reach, so its test sits here like error-reporting.test.ts.
//
// Production carries a goals trigger (goals_plan_limit → enforce_goal_plan_limit,
// ledger version 20261128100000) that refuses a new active goal with
// PLAN_LIMIT_REACHED. It must come back the way every other plan-limited write
// does — planLimitReached (lib/action-result.ts), whose errorCode the goals
// screen answers with the upgrade hint (components/goals.tsx) — and never as
// the raw exception text.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { planLimitReached } from "@/lib/action-result";

const single = vi.fn();
const supabase = { from: () => ({ insert: () => ({ select: () => ({ single }) }) }) };
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ liveUser: async () => ({ supabase, userId: "u1" }) }));
vi.mock("@/lib/my-today", () => ({ myToday: async () => "2026-10-16" }));
vi.mock("@/lib/i18n/server", async () => {
  const { getDictionary } = await import("@/lib/i18n");
  return { getI18n: async () => ({ t: getDictionary("en"), locale: "en" }) };
});

import { createGoal } from "@/app/goal-actions";

const input = {
  metric: "body_weight", direction: "decrease", targetValue: 70, startValue: 80,
  targetDate: null, exerciseId: null, measureKey: null, title: null,
};

describe("createGoal — database refusals", () => {
  beforeEach(() => single.mockReset());

  it("answers the plan limit as planLimitReached", async () => {
    single.mockResolvedValue({ data: null, error: { code: "P0001", message: "PLAN_LIMIT_REACHED" } });
    const result = await createGoal(input);
    expect(result).toEqual(planLimitReached);
  });

  it("still answers the goals' own cap as GOAL_LIMIT", async () => {
    single.mockResolvedValue({ data: null, error: { code: "23514", message: "GOAL_LIMIT" } });
    const result = await createGoal(input);
    expect(result).toMatchObject({ ok: false, errorCode: "GOAL_LIMIT" });
  });

  it("passes an unknown database error through unchanged", async () => {
    single.mockResolvedValue({ data: null, error: { code: "XX000", message: "boom" } });
    expect(await createGoal(input)).toEqual({ ok: false, message: "boom" });
  });
});
