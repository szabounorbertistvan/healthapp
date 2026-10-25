import type { WriteResultV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { startMyMealPlan } from "@/app/nutrition-actions";

// Start the person's own meal plan: breakfast, lunch, dinner and a snack to fill — the web's startMyMealPlan().
export const dynamic = "force-dynamic";

export const POST = v1Route(async () => {
  const r = await startMyMealPlan();
  return apiJson<WriteResultV1 & { id?: string }>({ ok: r.ok, message: r.message, id: r.id });
});
