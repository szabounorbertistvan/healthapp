import type { CodedResultV1, MealSlotV1 } from "@healthapp/api/v1";
import { MEAL_SLOTS_V1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { copyMealFromDay } from "@/app/client-actions-food";

// "Same as yesterday" on an empty meal — the web's copyMealFromDay(slot, from, to).
export const dynamic = "force-dynamic";

export const POST = v1Route(async (request) => {
  const b = (await request.json().catch(() => null)) as { slot?: unknown; from?: unknown; to?: unknown } | null;
  if (!b || !MEAL_SLOTS_V1.includes(b.slot as MealSlotV1) || typeof b.from !== "string" || typeof b.to !== "string") {
    return apiJson<CodedResultV1>({ ok: false, errorCode: "INVALID_INPUT" }, 400);
  }
  const result = await copyMealFromDay(b.slot as MealSlotV1, b.from, b.to);
  return apiJson<CodedResultV1>({ ok: result.ok, message: result.message, errorCode: result.errorCode });
});
