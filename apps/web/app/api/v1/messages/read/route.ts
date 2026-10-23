import type { WriteResultV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { markConversationRead } from "@/app/actions";

// The thread is on screen: the other side's messages are read (mark_conversation_read).
export const dynamic = "force-dynamic";

export const POST = v1Route(async (request) => {
  const b = (await request.json().catch(() => null)) as { conversationId?: unknown } | null;
  if (!b || typeof b.conversationId !== "string") return apiJson<WriteResultV1>({ ok: false, message: "invalid" }, 400);
  const result = await markConversationRead(b.conversationId);
  return apiJson<WriteResultV1>({ ok: result.ok, message: result.message });
});
