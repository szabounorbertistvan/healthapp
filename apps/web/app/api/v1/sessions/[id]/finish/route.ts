import type { WriteResultV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { finishOpenSession } from "@/app/client-actions-training";

// "Finish" on a workout left open on an earlier day (DashboardV1.open_sessions):
// the web's own finishOpenSession(), as the token's owner.
export const dynamic = "force-dynamic";

export const POST = v1Route(async (request) => {
  const id = decodeURIComponent(new URL(request.url).pathname.split("/").at(-2) ?? "");
  const result = await finishOpenSession(id);
  return apiJson<WriteResultV1 & { sessionId?: string }>({ ok: result.ok, message: result.message, sessionId: result.sessionId });
});
