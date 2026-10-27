import type { WriteResultV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { follow, unfollow } from "@/app/social-follow-actions";

// Follow / unfollow — the web's FollowButton actions.
export const dynamic = "force-dynamic";

export const POST = v1Route(async (request) => {
  const b = (await request.json().catch(() => null)) as { userId?: unknown; follow?: unknown } | null;
  const id = typeof b?.userId === "string" ? b.userId : "";
  const r = b?.follow === true ? await follow(id) : await unfollow(id);
  return apiJson<WriteResultV1>({ ok: r.ok, message: r.message });
});
