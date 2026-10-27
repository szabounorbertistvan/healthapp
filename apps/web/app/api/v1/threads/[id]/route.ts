import type { ThreadV1 } from "@healthapp/api/v1";
import { apiError, apiJson, v1Route } from "@/lib/api/v1";
import { getConversationContext, getMessages } from "@/lib/data";

// Any thread the caller is in, from either side — the web's messages/[id]:
// conversation_context() answers null for anyone else.
export const dynamic = "force-dynamic";

export const GET = v1Route(async (request) => {
  const id = decodeURIComponent(new URL(request.url).pathname.split("/").at(-1) ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return apiError("not_found", 404);
  const context = await getConversationContext(id).catch(() => null);
  if (!context) return apiError("not_found", 404);
  const messages = await getMessages(id);
  return apiJson<ThreadV1>({
    id,
    other_name: context.other_name,
    side: context.side,
    open: context.open,
    messages: messages.map((m) => ({ id: m.id, body: m.body, at: m.at, mine: m.mine, attachment: m.attachment?.kind ?? null, attachment_seconds: m.attachment?.seconds ?? null })),
  });
});
