import type { RespondRequestV1, WriteResultV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { acceptCoachingRequest, declineCoachingRequest } from "@/app/coach-profile-actions";

// Accept (opens a conversation; makes nobody a client yet) or decline a request.
export const dynamic = "force-dynamic";

export const POST = v1Route(async (request) => {
  const b = (await request.json().catch(() => null)) as Partial<RespondRequestV1> | null;
  if (!b || typeof b.requestId !== "string" || typeof b.accept !== "boolean") {
    return apiJson<WriteResultV1>({ ok: false, message: "invalid" }, 400);
  }
  const result = b.accept ? await acceptCoachingRequest(b.requestId) : await declineCoachingRequest(b.requestId);
  return apiJson<WriteResultV1>({ ok: result.ok, message: result.message });
});
