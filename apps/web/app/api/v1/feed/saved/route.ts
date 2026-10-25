import type { FeedV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { feedPost } from "@/lib/api/feed";
import { getSavedPosts } from "@/lib/social-data";

// The reader's own saved posts, newest save first — the web's /saved; ?before= is the save-time cursor.
export const dynamic = "force-dynamic";

export const GET = v1Route(async (request) => {
  const page = await getSavedPosts(new URL(request.url).searchParams.get("before"));
  return apiJson<FeedV1>({ next_cursor: page.next_cursor, items: page.items.map(feedPost) });
});
