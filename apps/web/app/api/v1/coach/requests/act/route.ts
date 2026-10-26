import type { CodedResultV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import {
  acceptCoachingRequest, declineCoachingRequest, openRequestConversation, startCoachingFromRequest,
} from "@/app/coach-profile-actions";

// One move on a contact request — the web's /requests buttons: accept, decline,
// start (the deliberate second step: they become the coach's client) and
// message (the pair's one conversation, opened or created empty). The database
// decides each; `conversationId` comes back for message.
export const dynamic = "force-dynamic";

export const POST = v1Route(async (request) => {
  const b = (await request.json().catch(() => null)) as { op?: unknown; requestId?: unknown } | null;
  const id = typeof b?.requestId === "string" ? b.requestId : "";
  const r: (CodedResultV1 & { conversationId?: string }) | null =
    b?.op === "accept" ? await acceptCoachingRequest(id)
    : b?.op === "decline" ? await declineCoachingRequest(id)
    : b?.op === "start" ? await startCoachingFromRequest(id)
    : b?.op === "message" ? await openRequestConversation(id)
    : null;
  if (!r) return apiJson<CodedResultV1>({ ok: false, errorCode: "INVALID_INPUT" }, 400);
  return apiJson<CodedResultV1 & { conversationId?: string }>({ ok: r.ok, message: r.message, errorCode: r.errorCode, conversationId: r.conversationId });
});
