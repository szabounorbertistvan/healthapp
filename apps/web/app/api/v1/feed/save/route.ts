import type { WriteResultV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { setPostSaved } from "@/app/social-actions";

// Save a post to the reader's own list, or take it off — the web's setPostSaved(). Nobody is told.
export const dynamic = "force-dynamic";

export const POST = v1Route(async (request) => {
  const b = (await request.json().catch(() => null)) as { postId?: unknown; save?: unknown } | null;
  if (!b || typeof b.postId !== "string" || typeof b.save !== "boolean") {
    return apiJson<WriteResultV1>({ ok: false, message: "invalid save" }, 400);
  }
  const result = await setPostSaved(b.postId, b.save);
  return apiJson<WriteResultV1>({ ok: result.ok, message: result.message });
});
