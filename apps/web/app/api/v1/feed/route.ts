import type { FeedV1, WriteResultV1 } from "@healthapp/api/v1";
import { isFeedScope } from "@healthapp/shared";
import { apiJson, v1Route } from "@/lib/api/v1";
import { createTextPost } from "@/app/social-actions";
import { feedPost } from "@/lib/api/feed";
import { getFeed } from "@/lib/social-data";

// The app's feed — /feed's own read (social_feed(): the scope widens who is
// listed, never what may be seen), paged on the same created_at cursor; and a
// new text post through the web's createTextPost().
export const dynamic = "force-dynamic";

export const GET = v1Route(async (request) => {
  const q = new URL(request.url).searchParams;
  const scope = q.get("scope");
  const page = await getFeed({ before: q.get("before"), scope: isFeedScope(scope) ? scope : "following" });
  return apiJson<FeedV1>({ next_cursor: page.next_cursor, items: page.items.map(feedPost) });
});

export const POST = v1Route(async (request) => {
  const b = (await request.json().catch(() => null)) as { text?: unknown; visibility?: unknown } | null;
  if (!b || typeof b.text !== "string") return apiJson<WriteResultV1 & { postId?: string }>({ ok: false, message: "invalid post" }, 400);
  const result = await createTextPost(b.text, typeof b.visibility === "string" ? b.visibility : undefined);
  return apiJson<WriteResultV1 & { postId?: string }>({ ok: result.ok, message: result.message, postId: result.postId });
});
