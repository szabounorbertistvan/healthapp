import "server-only";
import type { CommentV1, FeedPostV1 } from "@healthapp/api/v1";
import type { FeedPost, PostComment } from "@/lib/types";

// A post and a comment on the /api/v1 contract — the feed, a post's page and
// the comment list share these, so every surface draws the same post.
export function feedPost(p: FeedPost): FeedPostV1 {
  return {
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
    saved: p.saved,
    media: p.media.map((m) => ({ id: m.id, kind: m.kind, url: m.url, width: m.width, height: m.height })),
  };
}

export function comment(c: PostComment): CommentV1 {
  return {
    id: c.id,
    parent_id: c.parent_id,
    user_id: c.user_id,
    author_name: c.author_name,
    author_avatar: c.author_avatar,
    body: c.body,
    created_at: c.created_at,
    edited_at: c.edited_at,
    mine: c.mine,
  };
}
