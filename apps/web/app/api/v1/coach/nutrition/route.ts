import type { CoachNutritionV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { getNutritionPlans, getRoster } from "@/lib/data";

// The coach's nutrition plans — the web's /nutrition, and /nutrition/new's client list.
export const dynamic = "force-dynamic";

export const GET = v1Route(async () => {
  const [plans, roster] = await Promise.all([getNutritionPlans(), getRoster()]);
  return apiJson<CoachNutritionV1>({ plans, roster });
});
