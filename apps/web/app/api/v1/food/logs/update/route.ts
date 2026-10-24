import type { WriteResultV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { updateFoodLog } from "@/app/client-actions-food";

// Correct the grams of one diary entry — the web's updateFoodLog() (FoodEntry's
// in-place edit): the same range check, the macros re-scaled from the entry's own.
export const dynamic = "force-dynamic";

export const POST = v1Route(async (request) => {
  const b = (await request.json().catch(() => null)) as { id?: unknown; grams?: unknown } | null;
  if (!b || typeof b.id !== "string" || typeof b.grams !== "number") {
    return apiJson<WriteResultV1>({ ok: false, message: "invalid input" }, 400);
  }
  const result = await updateFoodLog(b.id, b.grams);
  return apiJson<WriteResultV1>({ ok: result.ok, message: result.message });
});
