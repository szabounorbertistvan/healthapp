import type { FeedV1 } from "@healthapp/api/v1";
import { isFeedScope } from "@healthapp/shared";
import { apiJson, v1Route } from "@/lib/api/v1";
import { getFeed } from "@/lib/social-data";

// The app's feed — /feed's own read (social_feed(): the scope widens who is
// listed, never what may be seen), paged on the same created_at cursor.
export const dynamic = "force-dynamic";

export const GET = v1Route(async (request) => {
  const q = new URL(request.url).searchParams;
  const scope = q.get("scope");
  const page = await getFeed({ before: q.get("before"), scope: isFeedScope(scope) ? scope : "following" });
  return apiJson<FeedV1>({
    next_cursor: page.next_cursor,
    items: page.items.map((p) => ({
      id: p.id,
      user_id: p.user_id,
      author_name: p.author_name,
      author_avatar: p.author_avatar,
      type: p.type,
      text: p.text,
      payload: p.payload,
      created_at: p.created_at,
      kudos_count: p.kudos_count,
      love_count: p.love_count,
      comment_count: p.comment_count,
      my_reaction: p.my_reaction,
      mine: p.mine,
      media: p.media.map((m) => ({ id: m.id, kind: m.kind, url: m.url, width: m.width, height: m.height })),
    })),
  });
});
