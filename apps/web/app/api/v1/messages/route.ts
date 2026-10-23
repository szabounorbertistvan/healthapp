import type { CodedResultV1, SendMessageV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { sendMessage } from "@/app/actions";

// Send a text message — the web's sendMessage(): RLS (conversation_open)
// decides whether this conversation still takes messages.
export const dynamic = "force-dynamic";

export const POST = v1Route(async (request) => {
  const b = (await request.json().catch(() => null)) as Partial<SendMessageV1> | null;
  if (!b || typeof b.conversationId !== "string" || typeof b.body !== "string") {
    return apiJson<CodedResultV1>({ ok: false, message: "invalid message" }, 400);
  }
  const result = await sendMessage(b.conversationId, b.body.slice(0, 4000));
  return apiJson<CodedResultV1>({ ok: result.ok, message: result.message, errorCode: result.errorCode });
});
