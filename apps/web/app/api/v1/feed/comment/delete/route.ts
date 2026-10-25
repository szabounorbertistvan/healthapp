import type { WriteResultV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { deleteComment } from "@/app/social-comment-actions";

// Delete your own comment — the web's deleteComment().
export const dynamic = "force-dynamic";

export const POST = v1Route(async (request) => {
  const b = (await request.json().catch(() => null)) as { commentId?: unknown; postId?: unknown } | null;
  if (!b || typeof b.commentId !== "string" || typeof b.postId !== "string") {
    return apiJson<WriteResultV1>({ ok: false, message: "invalid comment" }, 400);
  }
  const result = await deleteComment(b.commentId, b.postId);
  return apiJson<WriteResultV1>({ ok: result.ok, message: result.message });
});
