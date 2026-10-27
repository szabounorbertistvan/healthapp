import type { FollowListV1 } from "@healthapp/api/v1";
import { apiError, apiJson, v1Route } from "@/lib/api/v1";
import { getFollowList, getSocialProfile } from "@/lib/social-data";

// /people/[id]/followers and /following — one page of the list (?before= is the
// cursor, ?q= searches the whole list), with the profile's server-side counts.
export const dynamic = "force-dynamic";

export const GET = v1Route(async (request) => {
  const url = new URL(request.url);
  const parts = url.pathname.split("/");
  const list = parts.at(-1);
  const id = decodeURIComponent(parts.at(-2) ?? "");
  if (list !== "followers" && list !== "following") return apiError("not_found", 404);
  const [profile, page] = await Promise.all([
    getSocialProfile(id), getFollowList(id, list, url.searchParams.get("before"), url.searchParams.get("q")),
  ]);
  if (!profile) return apiError("not_found", 404);
  return apiJson<FollowListV1>({ items: page.items, next_cursor: page.next_cursor, followers: profile.followers, following: profile.following, name: profile.name, me: profile.me });
});
