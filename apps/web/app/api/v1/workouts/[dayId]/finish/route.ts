import type { WriteResultV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { finishWorkout } from "@/app/client-actions-training";

// "Finish workout" from the app: the web's own finishWorkout(), as the token's owner.
export const dynamic = "force-dynamic";

export const POST = v1Route(async (request) => {
  const parts = new URL(request.url).pathname.split("/");
  const dayId = decodeURIComponent(parts.at(-2) ?? "");
  const result = await finishWorkout(dayId);
  // the session id opens "Workout completed!" (/sessions/[id]/done)
  return apiJson<WriteResultV1 & { sessionId?: string }>({ ok: result.ok, message: result.message, sessionId: result.sessionId });
});
