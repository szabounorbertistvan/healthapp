import type { WriteResultV1 } from "@healthapp/api/v1";
import type { ReactionType } from "@healthapp/shared";
import { apiJson, v1Route } from "@/lib/api/v1";
import { react } from "@/app/social-actions";

// Press kudos or love on a post — the web's react(): the same one again takes it
// back, the other one replaces it; `reaction` is the state afterwards.
export const dynamic = "force-dynamic";

export const POST = v1Route(async (request) => {
  const b = (await request.json().catch(() => null)) as { postId?: unknown; type?: unknown } | null;
  if (!b || typeof b.postId !== "string" || typeof b.type !== "string") {
    return apiJson<WriteResultV1 & { reaction?: ReactionType | null }>({ ok: false, message: "invalid reaction" }, 400);
  }
  const result = await react(b.postId, b.type as ReactionType);
  return apiJson<WriteResultV1 & { reaction?: ReactionType | null }>({ ok: result.ok, message: result.message, reaction: result.reaction });
});
