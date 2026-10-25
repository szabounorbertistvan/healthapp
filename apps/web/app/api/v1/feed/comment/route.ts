import type { WriteResultV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { addComment } from "@/app/social-comment-actions";

// A comment, or a reply to one — the web's addComment(): mentions resolved by the database, never by the text.
export const dynamic = "force-dynamic";

export const POST = v1Route(async (request) => {
  const b = (await request.json().catch(() => null)) as { postId?: unknown; body?: unknown; parentId?: unknown } | null;
  if (!b || typeof b.postId !== "string" || typeof b.body !== "string") {
    return apiJson<WriteResultV1>({ ok: false, message: "invalid comment" }, 400);
  }
  const result = await addComment(b.postId, b.body, typeof b.parentId === "string" ? b.parentId : null);
  return apiJson<WriteResultV1 & { id?: string }>({ ok: result.ok, message: result.message, id: result.id });
});
