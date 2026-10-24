import type { CodedResultV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { deleteGoal } from "@/app/goal-actions";

// Delete a goal for good — the web's deleteGoal().
export const dynamic = "force-dynamic";

export const POST = v1Route(async (request) => {
  const b = (await request.json().catch(() => null)) as { goalId?: unknown } | null;
  if (!b || typeof b.goalId !== "string") return apiJson<CodedResultV1>({ ok: false, errorCode: "INVALID_INPUT" }, 400);
  const result = await deleteGoal(b.goalId);
  return apiJson<CodedResultV1>({ ok: result.ok, message: result.message, errorCode: result.errorCode });
});
