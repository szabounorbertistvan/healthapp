import type { WriteResultV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { setMyNutritionTargets } from "@/app/client-actions-food";

// The person's own daily targets: calories and a protein / carbs / fat split —
// the web's setMyNutritionTargets(); grams are derived on the server from the split.
export const dynamic = "force-dynamic";

export const POST = v1Route(async (request) => {
  const b = (await request.json().catch(() => null)) as { kcal?: unknown; split?: { protein?: unknown; carbs?: unknown; fat?: unknown } } | null;
  const n = (v: unknown) => (typeof v === "number" ? v : NaN);
  if (!b || !b.split) return apiJson<WriteResultV1>({ ok: false, message: "invalid targets" }, 400);
  const r = await setMyNutritionTargets({ kcal: n(b.kcal), split: { protein: n(b.split.protein), carbs: n(b.split.carbs), fat: n(b.split.fat) } });
  return apiJson<WriteResultV1>({ ok: r.ok, message: r.message });
});
