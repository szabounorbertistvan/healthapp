import type { PersonPageV1 } from "@healthapp/api/v1";
import { apiError, apiJson, v1Route } from "@/lib/api/v1";
import { feedPost } from "@/lib/api/feed";
import { getProfileRoutines } from "@/lib/routine-data";
import { getFeed, getMutualFollowers, getProfileBadges, getSocialProfile } from "@/lib/social-data";

// A person's profile — the web's /people/[id]: the header the privacy rules
// let this reader see (social_profile), the mutual followers, the published
// routines, and only the active tab's list. ?type= filters the posts
// (workout | pr | challenge_completed | achievement), ?before= pages them.
export const dynamic = "force-dynamic";

const TYPES = { workouts: "workout", prs: "pr", challenges: "challenge_completed", achievements: "achievement" } as const;

export const GET = v1Route(async (request) => {
  const url = new URL(request.url);
  const id = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
  const q = url.searchParams;
  const requested = q.get("tab") === "achievements" ? "achievements" : q.get("tab") === "programs" ? "programs" : "posts";
  const type = TYPES[(q.get("type") ?? "") as keyof typeof TYPES] ?? null;
  const [profile, mutuals, routines, posts, badges] = await Promise.all([
    getSocialProfile(id), getMutualFollowers(id), getProfileRoutines(id),
    requested === "posts" ? getFeed({ author: id, type, before: q.get("before") }) : Promise.resolve(null),
    requested === "achievements" ? getProfileBadges(id) : Promise.resolve([]),
  ]);
  if (!profile) return apiError("not_found", 404);
  // a tab exists only when there is something behind it this reader may see
  const tab = requested === "achievements" && !profile.stats_visible ? "posts" : requested === "programs" && routines.length === 0 ? "posts" : requested;
  return apiJson<PersonPageV1>({
    profile, mutuals, routines, tab,
    posts: posts ? { next_cursor: posts.next_cursor, items: posts.items.map(feedPost) } : null,
    badges,
  });
});
