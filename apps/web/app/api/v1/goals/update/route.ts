import type { CodedResultV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { updateGoal } from "@/app/goal-actions";

// Adjust an active goal's name, target and deadline — the web's updateGoal().
export const dynamic = "force-dynamic";

export const POST = v1Route(async (request) => {
  const b = (await request.json().catch(() => null)) as Parameters<typeof updateGoal>[0] | null;
  if (!b || typeof b !== "object") return apiJson<CodedResultV1>({ ok: false, errorCode: "INVALID_INPUT" }, 400);
  const result = await updateGoal(b);
  return apiJson<CodedResultV1>({ ok: result.ok, message: result.message, errorCode: result.errorCode });
});
