import type { WriteResultV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { editPost } from "@/app/social-actions";

// Edit the words of your own post — the web's editPost (the ••• menu's Edit):
// only your own and not deleted; the kind of post decides what may change.
export const dynamic = "force-dynamic";

export const POST = v1Route(async (request) => {
  const b = (await request.json().catch(() => null)) as { postId?: unknown; text?: unknown } | null;
  const r = await editPost(typeof b?.postId === "string" ? b.postId : "", typeof b?.text === "string" ? b.text : "");
  return apiJson<WriteResultV1>({ ok: r.ok, message: r.message });
});
