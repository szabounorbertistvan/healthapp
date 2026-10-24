import type { CodedResultV1, CreateGoalV1, GoalsV1 } from "@healthapp/api/v1";
import { apiError, apiJson, v1Route } from "@/lib/api/v1";
import { createGoal } from "@/app/goal-actions";
import { getProfile } from "@/lib/data";
import { getMyGoalDashboard } from "@/lib/goals-data";
import { getPlan } from "@/lib/plan";

// Progress → Goals for the app: the web's getMyGoalDashboard() (progress folded
// by packages/shared over the person's own rows), the units, the plan's limit;
// and a new goal through the web's createGoal().
export const dynamic = "force-dynamic";

export const GET = v1Route(async () => {
  const [dashboard, profile, plan] = await Promise.all([getMyGoalDashboard(), getProfile(), getPlan()]);
  if (!dashboard || !profile) return apiError("not_found", 404);
  return apiJson<GoalsV1>({
    today: dashboard.today,
    main_goal: dashboard.mainGoal,
    active: dashboard.active,
    closed: dashboard.closed,
    current: dashboard.current,
    exercises: dashboard.exercises,
    kcal_target: dashboard.kcalTarget,
    weight_unit: profile.weight_unit,
    length_unit: profile.length_unit,
    max_active: plan.e.maxActiveGoals,
  });
});

export const POST = v1Route(async (request) => {
  const b = (await request.json().catch(() => null)) as CreateGoalV1 | null;
  if (!b || typeof b !== "object") return apiJson<CodedResultV1>({ ok: false, errorCode: "INVALID_INPUT" }, 400);
  const result = await createGoal(b);
  return apiJson<CodedResultV1>({ ok: result.ok, message: result.message, errorCode: result.errorCode });
});
