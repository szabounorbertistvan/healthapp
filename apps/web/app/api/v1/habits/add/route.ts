import type { WriteResultV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { addHabit } from "@/app/client-actions-habits";

// A new habit — the web's addHabit(name, days per week): a suggestion or one the person wrote.
export const dynamic = "force-dynamic";

export const POST = v1Route(async (request) => {
  const b = (await request.json().catch(() => null)) as { name?: unknown; targetPerWeek?: unknown } | null;
  if (!b || typeof b.name !== "string" || typeof b.targetPerWeek !== "number") {
    return apiJson<WriteResultV1>({ ok: false, message: "invalid habit" }, 400);
  }
  const result = await addHabit(b.name, b.targetPerWeek);
  return apiJson<WriteResultV1>({ ok: result.ok, message: result.message });
});
