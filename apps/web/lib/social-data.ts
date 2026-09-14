// Social feed reads, through the security-definer RPCs in the migration (one
// round trip per page, authors and counts folded in). Nothing here reads another person's sets, food or measurements — a post's
// payload is the only thing the feed shows about a workout.
import "server-only";
import {
  FEED_PAGE_SIZE,
  KUDOS_PAGE_SIZE,
  canSeePost,
  feedPage,
  estimated1RM,
  type PostPayload,
} from "@healthapp/shared";
import { currentActorId } from "./actor";
import { supabaseServer } from "./supabase/server";
import { loadOf } from "./training-load";
import { LOGGED_SET_SELECT, toLoggedSetRow, type SetJoin } from "./logged-sets";
import type { FeedPage, FeedPost, KudosGiver, KudosPage, PersonRow, PostComment, ShareableSession, SocialProfile } from "./types";

// ---------- feed ----------

/** The home feed (own + followed) or one author's posts, newest first, one page. */
export async function getFeed(opts: { before?: string | null; author?: string | null } = {}): Promise<FeedPage> {
  const viewer = await currentActorId();
  if (!viewer) return { items: [], next_cursor: null };
  const supabase = await supabaseServer();
  const { data } = await supabase.rpc("social_feed", {
    p_limit: FEED_PAGE_SIZE + 1,
    p_before: opts.before ?? null,
    p_author: opts.author ?? null,
  });
  type Row = Omit<FeedPost, "mine" | "payload"> & { payload: PostPayload | null; author_username: string | null };
  const rows = ((data ?? []) as Row[]).map((r) => ({ ...r, payload: r.payload ?? null, mine: r.user_id === viewer }));
  const items = rows.slice(0, FEED_PAGE_SIZE);
  return { items, next_cursor: rows.length > FEED_PAGE_SIZE ? items[items.length - 1]!.created_at : null };
}

export async function getPost(id: string): Promise<{ post: FeedPost; comments: PostComment[] } | null> {
  const viewer = await currentActorId();
  if (!viewer) return null;
  const supabase = await supabaseServer();
  const [{ data: post }, { data: comments }] = await Promise.all([
    // social_feed with p_author scoped to one id is the same shape; filter to the post.
    supabase.from("social_posts").select("user_id").eq("id", id).maybeSingle(),
    supabase.rpc("social_post_comments", { p_post: id }),
  ]);
  if (!post) return null;
  const { data: rows } = await supabase.rpc("social_feed", { p_limit: 50, p_before: null, p_author: post.user_id });
  type Row = Omit<FeedPost, "mine">;
  const found = ((rows ?? []) as Row[]).find((r) => r.id === id);
  if (!found) return null;
  type CommentRow = Omit<PostComment, "mine">;
  return {
    post: { ...found, payload: found.payload ?? null, mine: found.user_id === viewer },
    comments: ((comments ?? []) as CommentRow[]).map((c) => ({ ...c, mine: c.user_id === viewer })),
  };
}

// ---------- kudos ----------

/**
 * Who gave kudos on a post, newest first, one page. Empty — not an error —
 * for a post the viewer may not see: social_post_kudos() returns no rows.
 * The card's count is the only way in.
 */
export async function getPostKudos(postId: string, before: string | null = null): Promise<KudosPage> {
  const viewer = await currentActorId();
  if (!viewer) return { items: [], next_cursor: null };
  const supabase = await supabaseServer();
  const { data } = await supabase.rpc("social_post_kudos", { p_post: postId, p_limit: KUDOS_PAGE_SIZE + 1, p_before: before });
  const rows = ((data ?? []) as (KudosGiver & { username: string | null })[]).map(({ username: _u, ...r }) => r);
  const items = rows.slice(0, KUDOS_PAGE_SIZE);
  return { items, next_cursor: rows.length > KUDOS_PAGE_SIZE ? items[items.length - 1]!.created_at : null };
}

// ---------- people ----------

export async function getSocialProfile(userId: string): Promise<SocialProfile | null> {
  const viewer = await currentActorId();
  if (!viewer) return null;
  const supabase = await supabaseServer();
  const { data } = await supabase.rpc("social_profile", { p_user: userId });
  const row = ((data ?? []) as Omit<SocialProfile, "me">[])[0];
  return row ? { ...row, me: row.id === viewer } : null;
}

export async function searchPeople(query: string): Promise<PersonRow[]> {
  const viewer = await currentActorId();
  const q = query.trim().toLowerCase();
  if (!viewer || q.length < 2) return [];
  const supabase = await supabaseServer();
  const { data } = await supabase.rpc("social_search_users", { p_query: q });
  return (data ?? []) as PersonRow[];
}

/** People the viewer follows / who follow them — for the profile lists. */
export async function getFollowList(userId: string, which: "followers" | "following"): Promise<PersonRow[]> {
  const viewer = await currentActorId();
  if (!viewer) return [];
  // Live: follows_select only shows edges the viewer is on, so lists are
  // exact for the viewer's own profile and empty for others — enough for v1.
  const supabase = await supabaseServer();
  const col = which === "followers" ? "following_id" : "follower_id";
  const other = which === "followers" ? "follower_id" : "following_id";
  const { data } = await supabase.from("social_follows").select(other).eq(col, userId);
  const ids = ((data ?? []) as Record<string, string>[]).map((r) => r[other]!).filter(Boolean);
  const people = await Promise.all(ids.map((id) => getSocialProfile(id)));
  return people
    .filter((p): p is SocialProfile => p !== null)
    .map((p) => ({ id: p.id, name: p.name, username: p.username, avatar_url: p.avatar_url, is_following: p.is_following }));
}

// ---------- sharing a workout ----------

/**
 * What the "Workout completed" screen can share: the session's aggregates
 * (the same numbers the history row shows) and its PRs. Only the owner's
 * own session — live, RLS makes any other id return nothing.
 */
export async function getShareableSession(sessionId: string): Promise<ShareableSession | null> {
  const viewer = await currentActorId();
  if (!viewer) return null;
  const supabase = await supabaseServer();
  const [{ data: s }, { data: posts }] = await Promise.all([
    supabase
      .from("logged_sessions")
      .select(`id, started_at, completed_at, day:program_days(name), logged_sets(${LOGGED_SET_SELECT})`)
      .eq("id", sessionId)
      .eq("user_id", viewer)
      .maybeSingle(),
    supabase.from("social_posts").select("type, payload").eq("activity_id", sessionId).is("deleted_at", null),
  ]);
  if (!s) return null;
  type Row = { id: string; started_at: string; completed_at: string | null; day: { name: string } | null; logged_sets: SetJoin[] | null };
  const row = s as unknown as Row;
  const sets = (row.logged_sets ?? []).map(toLoggedSetRow);
  const load = loadOf(sets, row.started_at, row.completed_at);
  type PostRow = { type: string; payload: { exercise?: string } | null };
  const existing = (posts ?? []) as PostRow[];
  const sharedPr = new Set(existing.filter((p) => p.type === "pr").map((p) => p.payload?.exercise));
  return {
    session_id: row.id,
    name: row.day?.name ?? "Workout",
    date: row.started_at.slice(0, 10),
    duration_min: load.duration_min,
    exercises: load.exercises,
    sets: load.sets,
    volume_kg: load.volume_kg,
    load: load.score,
    prs: sets.filter((x) => x.is_pr).map((x) => ({
      set_id: x.id, exercise: x.exercise, weight_kg: x.weight_kg, reps: x.reps,
      estimated_1rm: estimated1RM(x.weight_kg, x.reps), shared: sharedPr.has(x.exercise),
    })),
    already_shared: existing.some((p) => p.type === "workout"),
  };
}
