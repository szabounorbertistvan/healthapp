import type { CodedResultV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { closeGoal } from "@/app/goal-actions";

// Mark a goal achieved or abandon it — the web's closeGoal().
export const dynamic = "force-dynamic";

export const POST = v1Route(async (request) => {
  const b = (await request.json().catch(() => null)) as { goalId?: unknown; outcome?: unknown } | null;
  if (!b || typeof b.goalId !== "string" || (b.outcome !== "achieved" && b.outcome !== "abandoned")) {
    return apiJson<CodedResultV1>({ ok: false, errorCode: "INVALID_INPUT" }, 400);
  }
  const result = await closeGoal(b.goalId, b.outcome);
  return apiJson<CodedResultV1>({ ok: result.ok, message: result.message, errorCode: result.errorCode });
});
