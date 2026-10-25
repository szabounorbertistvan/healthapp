import type { FitnessScoreV1 } from "@healthapp/api/v1";
import { apiError, apiJson, v1Route } from "@/lib/api/v1";
import { getMyFitnessScore } from "@/lib/fitness-score-data";
import { getPlan } from "@/lib/plan";

// The reader's fitness score — the web's /fitness-score; the plan gates the trend and the breakdown.
export const dynamic = "force-dynamic";

export const GET = v1Route(async () => {
  const [view, plan] = await Promise.all([getMyFitnessScore(), getPlan()]);
  if (!view) return apiError("unauthorized", 401);
  return apiJson<FitnessScoreV1>({ current: view.current, previous: view.previous, trend: view.trend, today: view.today, charts: plan.e.progressCharts });
});
