import type { WriteResultV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { deletePost } from "@/app/social-actions";

// Delete your own post — the web's deletePost().
export const dynamic = "force-dynamic";

export const POST = v1Route(async (request) => {
  const b = (await request.json().catch(() => null)) as { postId?: unknown } | null;
  if (!b || typeof b.postId !== "string") return apiJson<WriteResultV1>({ ok: false, message: "invalid post" }, 400);
  const result = await deletePost(b.postId);
  return apiJson<WriteResultV1>({ ok: result.ok, message: result.message });
});
