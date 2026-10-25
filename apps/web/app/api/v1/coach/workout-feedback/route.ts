import type { CodedResultV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { addWorkoutFeedback, deleteWorkoutFeedback } from "@/app/workout-feedback-actions";

// A coach's comment on a client's workout or on one set, or taking one back —
// the web's addWorkoutFeedback() / deleteWorkoutFeedback().
export const dynamic = "force-dynamic";

export const POST = v1Route(async (request) => {
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  if (!b) return apiJson<CodedResultV1>({ ok: false, errorCode: "INVALID_INPUT" }, 400);
  const r = b.op === "delete"
    ? await deleteWorkoutFeedback(str(b.feedbackId), str(b.clientId))
    : await addWorkoutFeedback({
        clientId: str(b.clientId),
        referenceType: b.referenceType === "set" ? "set" : "session",
        referenceId: str(b.referenceId),
        body: str(b.body),
      });
  return apiJson<CodedResultV1>({ ok: r.ok, message: r.message, errorCode: r.errorCode });
});
