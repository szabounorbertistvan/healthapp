import type { MessageUploadV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { discardMessageUpload, requestMessageUpload, sendMessageWithAttachment } from "@/app/message-actions";

// A photo or a voice note in a conversation — the web's message-thread.tsx
// flow, the same actions: ticket (one signed private upload for this
// conversation), send (the message, naming the upload; the server checks what
// Cloudinary stored), discard (an upload that was never sent).
export const dynamic = "force-dynamic";

export const POST = v1Route(async (request) => {
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const conversationId = typeof b?.conversationId === "string" ? b.conversationId : "";
  const kind = b?.kind === "audio" ? "audio" : "image";
  if (b?.op === "ticket") {
    const r = await requestMessageUpload({ conversationId, kind });
    return apiJson<MessageUploadV1>({ ok: r.ok, message: r.message, errorCode: r.errorCode, ticket: r.ticket });
  }
  if (b?.op === "send") {
    const r = await sendMessageWithAttachment({
      conversationId, body: typeof b.body === "string" ? b.body : null, attachment: { kind, publicId: typeof b.publicId === "string" ? b.publicId : "" },
    });
    return apiJson<MessageUploadV1>({ ok: r.ok, message: r.message, errorCode: r.errorCode });
  }
  if (b?.op === "discard") {
    const r = await discardMessageUpload(conversationId, typeof b.publicId === "string" ? b.publicId : "", kind);
    return apiJson<MessageUploadV1>({ ok: r.ok, message: r.message });
  }
  return apiJson<MessageUploadV1>({ ok: false, errorCode: "INVALID_INPUT" }, 400);
});
