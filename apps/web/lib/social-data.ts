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
import type {
  CommentPage, CommentThread, FeedPage, FeedPost, KudosGiver, KudosPage, MutualFollowers,
  PersonRow, PostComment, ProfileBadge, ShareableSession, SocialPrivacy, SocialProfile,
} from "./types";
import type { FeedScope } from "@healthapp/shared";

// ---------- feed ----------

type RawMention = { user_id: string; username: string | null };

/** A mention whose user has no username cannot be rendered as a handle, so it is dropped. */
function resolvedMentions(raw: RawMention[] | null | undefined): { user_id: string; username: string }[] {
  return (raw ?? []).filter((m): m is { user_id: string; username: string } => Boolean(m.username));
}

/** The home feed (own + followed) or one author's posts, newest first, one page. */
export async function getFeed(
  opts: { before?: string | null; author?: string | null; scope?: FeedScope; type?: string | null } = {},
): Promise<FeedPage> {
  const viewer = await currentActorId();
  if (!viewer) return { items: [], next_cursor: null };
  const supabase = await supabaseServer();
  const { data } = await supabase.rpc("social_feed", {
    p_limit: FEED_PAGE_SIZE + 1,
    p_before: opts.before ?? null,
    p_author: opts.author ?? null,
    p_scope: opts.scope ?? "following",
    p_type: opts.type ?? null,
  });
  type Row = Omit<FeedPost, "mine" | "payload" | "mentions"> & {
    payload: PostPayload | null; author_username: string | null; mentions: RawMention[] | null;
  };
  const rows = ((data ?? []) as Row[]).map((r) => ({
    ...r, payload: r.payload ?? null, mentions: resolvedMentions(r.mentions), edited_at: r.edited_at ?? null, mine: r.user_id === viewer,
  }));
  const items = rows.slice(0, FEED_PAGE_SIZE);
  return { items, next_cursor: rows.length > FEED_PAGE_SIZE ? items[items.length - 1]!.created_at : null };
}

/**
 * One post and the first page of its conversation.
 *
 * This used to ask social_feed for fifty posts by the same author and scan for
 * the one it wanted; social_post() answers by id. Both come back empty for a
 * post the reader may not see, which is what makes the route a real 404 rather
 * than a page that fetches something and then hides it.
 */
export async function getPost(id: string): Promise<{ post: FeedPost; comments: CommentPage } | null> {
  const viewer = await currentActorId();
  if (!viewer) return null;
  const supabase = await supabaseServer();
  const [{ data: rows }, comments] = await Promise.all([
    supabase.rpc("social_post", { p_post: id }),
    getComments(id),
  ]);
  type Row = Omit<FeedPost, "mine" | "mentions"> & { mentions: RawMention[] | null };
  const found = ((rows ?? []) as Row[])[0];
  if (!found) return null;
  return {
    post: {
      ...found, payload: found.payload ?? null, mentions: resolvedMentions(found.mentions),
      edited_at: found.edited_at ?? null, mine: found.user_id === viewer,
    },
    comments,
  };
}

export const COMMENT_PAGE_SIZE = 20;

/**
 * One page of a post's comments: top-level comments on a cursor, each with its
 * replies already attached.
 *
 * Replies come down with their parent rather than on their own cursor — a
 * reply is part of the comment it answers, and paging them separately would be
 * a round trip per comment on screen.
 */
export async function getComments(postId: string, before: string | null = null): Promise<CommentPage> {
  const viewer = await currentActorId();
  if (!viewer) return { items: [], next_cursor: null };
  const supabase = await supabaseServer();
  const { data } = await supabase.rpc("social_post_comments", {
    p_post: postId,
    p_limit: COMMENT_PAGE_SIZE + 1,
    p_before: before,
  });

  const rows = toComments(data, viewer);

  const roots = rows.filter((c) => c.parent_id === null);
  const page = roots.slice(0, COMMENT_PAGE_SIZE);
  const keep = new Set(page.map((c) => c.id));
  const items: CommentThread[] = page.map((root) => ({
    ...root,
    replies: rows
      .filter((c) => c.parent_id === root.id)
      .sort((a, b) => a.created_at.localeCompare(b.created_at)),
  }));
  // Replies of a root that fell off this page come back with it next time.
  void keep;
  const last = page[page.length - 1];
  return { items, next_cursor: roots.length > COMMENT_PAGE_SIZE && last ? last.created_at : null };
}

type CommentRow = Omit<PostComment, "mine" | "mentions"> & { mentions: RawMention[] | null };

function toComments(data: unknown, viewer: string): PostComment[] {
  return ((data ?? []) as CommentRow[]).map((c) => ({
    ...c,
    edited_at: c.edited_at ?? null,
    mentions: resolvedMentions(c.mentions),
    mine: c.user_id === viewer,
  }));
}

export const REPLY_PAGE_SIZE = 20;

/**
 * The replies to one comment after the ones already on screen, oldest first.
 * A thread arrives with its first three (social_post_comments); this is the
 * "show more replies" behind them. Empty for a post the reader cannot see.
 */
export async function getReplies(
  parentId: string,
  after: string | null,
): Promise<{ items: PostComment[]; next_cursor: string | null }> {
  const viewer = await currentActorId();
  if (!viewer) return { items: [], next_cursor: null };
  const supabase = await supabaseServer();
  const { data } = await supabase.rpc("social_comment_replies", {
    p_parent: parentId,
    p_after: after,
    p_limit: REPLY_PAGE_SIZE + 1,
  });
  const rows = toComments(data, viewer);
  const items = rows.slice(0, REPLY_PAGE_SIZE);
  return { items, next_cursor: rows.length > REPLY_PAGE_SIZE ? items[items.length - 1]!.created_at : null };
}

/** Who the author can mean by "@mar" — people who can see the post first. */
export async function getMentionCandidates(query: string, postId: string | null): Promise<PersonRow[]> {
  const viewer = await currentActorId();
  if (!viewer) return [];
  const supabase = await supabaseServer();
  const { data } = await supabase.rpc("social_mention_candidates", {
    p_query: query.trim(),
    p_post: postId,
  });
  type Row = { id: string; name: string; username: string | null; avatar_url: string | null; can_see: boolean };
  return ((data ?? []) as Row[]).map((r) => ({
    id: r.id, name: r.name, username: r.username, avatar_url: r.avatar_url, is_following: false,
  }));
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

/**
 * A person's badges, newest first. Empty — not an error — when their stats
 * are hidden from this reader: social_badges() applies can_see_stats itself.
 */
export async function getProfileBadges(userId: string): Promise<ProfileBadge[]> {
  const viewer = await currentActorId();
  if (!viewer) return [];
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("social_badges", { p_user: userId });
  if (error) console.error("badges read failed:", error.message);
  return (data ?? []) as ProfileBadge[];
}

/** The signed-in person's own social privacy settings and published score. */
export async function getMySocialPrivacy(): Promise<SocialPrivacy | null> {
  const viewer = await currentActorId();
  if (!viewer) return null;
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("users")
    .select("stats_visibility, fitness_score_visibility, fitness_score_public, fitness_score_public_at")
    .eq("id", viewer)
    .maybeSingle();
  if (!data) return null;
  return {
    stats_visibility: (data.stats_visibility as SocialPrivacy["stats_visibility"]) ?? "public",
    fitness_score_visibility: (data.fitness_score_visibility as SocialPrivacy["fitness_score_visibility"]) ?? "private",
    fitness_score_public: (data.fitness_score_public as number | null) ?? null,
    fitness_score_public_at: (data.fitness_score_public_at as string | null) ?? null,
  };
}

export const PEOPLE_PAGE_SIZE = 20;

/**
 * One page of people search. Offset-paged: results are ranked (prefix
 * matches first), and a keyset cursor over a rank is not worth its shape for
 * a list nobody scrolls past a few pages of. One extra row answers "is there
 * more?" without a count query.
 */
export async function searchPeople(
  query: string,
  city: string | null = null,
  page = 1,
): Promise<{ items: PersonRow[]; hasMore: boolean; page: number }> {
  const viewer = await currentActorId();
  const q = query.trim().toLowerCase();
  const c = city?.trim() ?? "";
  const current = Math.max(1, Math.floor(page) || 1);
  // Either half is enough to search on, so "everyone in Cluj" works with no
  // name typed at all.
  if (!viewer || (q.length < 2 && c.length < 2)) return { items: [], hasMore: false, page: current };
  const supabase = await supabaseServer();
  const { data } = await supabase.rpc("social_search_users", {
    p_query: q,
    p_city: c || null,
    p_limit: PEOPLE_PAGE_SIZE + 1,
    p_offset: (current - 1) * PEOPLE_PAGE_SIZE,
  });
  const rows = (data ?? []) as PersonRow[];
  return { items: rows.slice(0, PEOPLE_PAGE_SIZE), hasMore: rows.length > PEOPLE_PAGE_SIZE, page: current };
}

/**
 * People followed by the people you follow, most shared connections first.
 *
 * Counted, not modelled: the number beside each suggestion is how many of your
 * follows also follow them, which is a sentence you can say out loud. One
 * query over the follow edges.
 */
export async function getSuggestedPeople(limit = 10): Promise<PersonRow[]> {
  const viewer = await currentActorId();
  if (!viewer) return [];
  const supabase = await supabaseServer();
  const { data } = await supabase.rpc("social_suggested_people", { p_limit: limit });
  return (data ?? []) as PersonRow[];
}

/** "Followed by Maria and 3 others" — one query, never one per person. */
export async function getMutualFollowers(userId: string, limit = 3): Promise<MutualFollowers> {
  const viewer = await currentActorId();
  if (!viewer) return { people: [], total: 0 };
  const supabase = await supabaseServer();
  const { data } = await supabase.rpc("social_mutual_followers", { p_user: userId, p_limit: limit });
  type Row = { id: string; name: string; username: string | null; avatar_url: string | null; total: number };
  const rows = (data ?? []) as Row[];
  return {
    people: rows.map((r) => ({ id: r.id, name: r.name, username: r.username, avatar_url: r.avatar_url, is_following: true })),
    total: rows[0]?.total ?? 0,
  };
}

export const FOLLOW_PAGE_SIZE = 20;

export type FollowPage = { items: PersonRow[]; next_cursor: string | null };

/**
 * Who follows / is followed by a person, newest first, one page. Served by
 * social_follow_list() (security definer — users_select would hide the
 * names) with whether the viewer follows each of them folded in, so a list
 * of 20 is one round trip and no per-row lookups.
 */
export async function getFollowList(
  userId: string,
  which: "followers" | "following",
  before: string | null = null,
): Promise<FollowPage> {
  const viewer = await currentActorId();
  if (!viewer) return { items: [], next_cursor: null };
  const supabase = await supabaseServer();
  const { data } = await supabase.rpc("social_follow_list", {
    p_user: userId, p_which: which, p_limit: FOLLOW_PAGE_SIZE + 1, p_before: before,
  });
  type Row = PersonRow & { followed_at: string };
  const rows = (data ?? []) as Row[];
  const items = rows.slice(0, FOLLOW_PAGE_SIZE);
  return {
    items: items.map(({ followed_at: _f, ...r }) => r),
    next_cursor: rows.length > FOLLOW_PAGE_SIZE ? items[items.length - 1]!.followed_at : null,
  };
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
