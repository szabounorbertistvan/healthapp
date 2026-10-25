import type { PostDetailV1 } from "@healthapp/api/v1";
import { apiError, apiJson, v1Route } from "@/lib/api/v1";
import { comment, feedPost } from "@/lib/api/feed";
import { getComments, getPost } from "@/lib/social-data";

// One post's page for the app — /feed/[postId]'s own read: the post as this
// reader may see it, and its comments (older pages with ?before=).
export const dynamic = "force-dynamic";

export const GET = v1Route(async (request) => {
  const url = new URL(request.url);
  const id = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
  const before = url.searchParams.get("before");
  const found = await getPost(id);
  if (!found) return apiError("not_found", 404);
  const page = before ? await getComments(id, before) : found.comments;
  return apiJson<PostDetailV1>({
    post: feedPost(found.post),
    comments: {
      next_cursor: page.next_cursor,
      items: page.items.map((c) => ({ ...comment(c), replies: c.replies.map(comment) })),
    },
  });
});
