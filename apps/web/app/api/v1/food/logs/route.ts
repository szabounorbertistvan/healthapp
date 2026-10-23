import type { FoodLogV1, WriteResultV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { logFood } from "@/app/client-actions-food";

// One food log from the app's outbox — the web's logFood(). `clientId` is the
// phone's id for this one log, so a second delivery is a no-op.
export const dynamic = "force-dynamic";

export const POST = v1Route(async (request) => {
  const b = (await request.json().catch(() => null)) as Partial<FoodLogV1> | null;
  if (!b || typeof b.foodName !== "string" || !b.per100g || typeof b.slot !== "string") {
    return apiJson<WriteResultV1>({ ok: false, message: "invalid food" }, 400);
  }
  const p = b.per100g;
  const result = await logFood({
    slot: b.slot,
    foodName: b.foodName,
    grams: Number(b.grams),
    per100g: { kcal: Number(p.kcal), protein: Number(p.protein), carbs: Number(p.carbs), fat: Number(p.fat) },
    foodId: typeof b.foodId === "string" ? b.foodId : null,
    day: typeof b.day === "string" ? b.day : undefined,
    clientId: typeof b.clientId === "string" ? b.clientId : undefined,
  });
  return apiJson<WriteResultV1>({ ok: result.ok, message: result.message });
});
