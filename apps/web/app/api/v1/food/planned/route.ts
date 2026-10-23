import type { MealSlotV1, WriteResultV1 } from "@healthapp/api/v1";
import { MEAL_SLOTS_V1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { logPlannedMeal } from "@/app/client-actions-food";

// "Ate as planned" — the web's logPlannedMeal(): the plan is re-read on the
// server, and its derived keys make a double tap a no-op.
export const dynamic = "force-dynamic";

export const POST = v1Route(async (request) => {
  const b = (await request.json().catch(() => null)) as { slot?: string; day?: string; mealId?: string } | null;
  if (!b || !MEAL_SLOTS_V1.includes(b.slot as MealSlotV1)) return apiJson<WriteResultV1>({ ok: false, message: "invalid slot" }, 400);
  const result = await logPlannedMeal(b.slot as MealSlotV1, b.day, b.mealId);
  return apiJson<WriteResultV1>({ ok: result.ok, message: result.message });
});
