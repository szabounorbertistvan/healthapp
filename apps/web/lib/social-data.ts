// Social feed reads. Live mode goes through the security-definer RPCs in the
// migration (one round trip per page, authors and counts folded in); demo
// mode folds the in-process store with the same rules from @healthapp/shared.
// Nothing here reads another person's sets, food or measurements — a post's
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
import { isDemo, supabaseServer } from "./supabase/server";
import { store } from "./demo-store";
import { clientStore, type StoredPost } from "./demo-client-store";
import { loadOf } from "./training-load";
import { LOGGED_SET_SELECT, toLoggedSetRow, type SetJoin } from "./logged-sets";
import type { FeedPage, FeedPost, KudosGiver, KudosPage, PersonRow, PostComment, ShareableSession, SocialProfile } from "./types";

// ---------- demo helpers ----------

function demoName(userId: string): string {
  return store().clients.find((c) => c.client_id === userId)?.full_name ?? userId;
}

function demoFollows(userId: string): Set<string> {
  return new Set(clientStore().follows.filter((f) => f.follower_id === userId).map((f) => f.following_id));
}

function demoFeedPost(p: StoredPost, viewer: string): FeedPost {
  const cs = clientStore();
  const kudos = cs.reactions.filter((r) => r.post_id === p.id).sort((a, b) => a.created_at.localeCompare(b.created_at));
  return {
    id: p.id,
    user_id: p.user_id,
    author_name: demoName(p.user_id),
    author_avatar: null,
    type: p.type,
    text: p.text,
    payload: p.payload,
    visibility: p.visibility,
    created_at: p.created_at,
    activity_id: p.activity_id,
    challenge_id: p.challenge_id,
    kudos_count: kudos.length,
    comment_count: cs.comments.filter((c) => c.post_id === p.id).length,
    my_kudos: kudos.some((r) => r.user_id === viewer),
    kudos_names: kudos.slice(0, 2).map((r) => demoName(r.user_id)),
    mine: p.user_id === viewer,
  };
}

// ---------- feed ----------

/** The home feed (own + followed) or one author's posts, newest first, one page. */
export async function getFeed(opts: { before?: string | null; author?: string | null } = {}): Promise<FeedPage> {
  const viewer = await currentActorId();
  if (!viewer) return { items: [], next_cursor: null };
  if (isDemo) {
    const cs = clientStore();
    const follows = demoFollows(viewer);
    const source = opts.author
      ? cs.posts.filter((p) => p.user_id === opts.author && canSeePost(p, viewer, follows))
      : cs.posts;
    const page = opts.author
      ? (() => {
          const sorted = [...source].sort((a, b) => b.created_at.localeCompare(a.created_at)).filter((p) => !opts.before || p.created_at < opts.before);
          const items = sorted.slice(0, FEED_PAGE_SIZE);
          return { items, nextCursor: sorted.length > items.length ? items[items.length - 1]!.created_at : null };
        })()
      : feedPage(source, viewer, follows, { before: opts.before });
    return { items: page.items.map((p) => demoFeedPost(p, viewer)), next_cursor: page.nextCursor };
  }
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
  if (isDemo) {
    const cs = clientStore();
    const p = cs.posts.find((x) => x.id === id);
    if (!p || !canSeePost(p, viewer, demoFollows(viewer))) return null;
    return {
      post: demoFeedPost(p, viewer),
      comments: cs.comments
        .filter((c) => c.post_id === id)
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map((c) => ({ id: c.id, user_id: c.user_id, author_name: demoName(c.user_id), author_avatar: null, body: c.body, created_at: c.created_at, mine: c.user_id === viewer })),
    };
  }
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
 * for a post the viewer may not see: live, social_post_kudos() returns no
 * rows; demo, canSeePost() says no. The card's count is the only way in.
 */
export async function getPostKudos(postId: string, before: string | null = null): Promise<KudosPage> {
  const viewer = await currentActorId();
  if (!viewer) return { items: [], next_cursor: null };
  if (isDemo) {
    const cs = clientStore();
    const p = cs.posts.find((x) => x.id === postId);
    if (!p || !canSeePost(p, viewer, demoFollows(viewer))) return { items: [], next_cursor: null };
    const all = cs.reactions
      .filter((r) => r.post_id === postId && (!before || r.created_at < before))
      .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
    const items = all.slice(0, KUDOS_PAGE_SIZE).map((r) => ({
      user_id: r.user_id, name: demoName(r.user_id), avatar_url: null, created_at: r.created_at,
    }));
    return { items, next_cursor: all.length > items.length ? items[items.length - 1]!.created_at : null };
  }
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
  if (isDemo) {
    const cs = clientStore();
    const person = store().clients.find((c) => c.client_id === userId);
    if (!person) return null;
    return {
      id: userId,
      name: person.full_name,
      username: null,
      avatar_url: person.avatar_url,
      followers: cs.follows.filter((f) => f.following_id === userId).length,
      following: cs.follows.filter((f) => f.follower_id === userId).length,
      workouts: cs.sessions.filter((s) => s.client_id === userId && s.completed_at !== null).length,
      prs: cs.sets.filter((x) => x.is_pr && cs.sessions.some((s) => s.id === x.session_id && s.client_id === userId)).length,
      challenges: cs.participants.filter((p) => p.user_id === userId && p.completed_at !== null).length,
      is_following: cs.follows.some((f) => f.follower_id === viewer && f.following_id === userId),
      follows_me: cs.follows.some((f) => f.follower_id === userId && f.following_id === viewer),
      me: userId === viewer,
    };
  }
  const supabase = await supabaseServer();
  const { data } = await supabase.rpc("social_profile", { p_user: userId });
  const row = ((data ?? []) as Omit<SocialProfile, "me">[])[0];
  return row ? { ...row, me: row.id === viewer } : null;
}

export async function searchPeople(query: string): Promise<PersonRow[]> {
  const viewer = await currentActorId();
  const q = query.trim().toLowerCase();
  if (!viewer || q.length < 2) return [];
  if (isDemo) {
    const follows = demoFollows(viewer);
    return store()
      .clients.filter((c) => c.client_id !== viewer && c.full_name.toLowerCase().includes(q))
      .map((c) => ({ id: c.client_id, name: c.full_name, username: null, avatar_url: c.avatar_url, is_following: follows.has(c.client_id) }));
  }
  const supabase = await supabaseServer();
  const { data } = await supabase.rpc("social_search_users", { p_query: q });
  return (data ?? []) as PersonRow[];
}

/** People the viewer follows / who follow them — for the profile lists. */
export async function getFollowList(userId: string, which: "followers" | "following"): Promise<PersonRow[]> {
  const viewer = await currentActorId();
  if (!viewer) return [];
  if (isDemo) {
    const cs = clientStore();
    const mine = demoFollows(viewer);
    const ids = cs.follows
      .filter((f) => (which === "followers" ? f.following_id === userId : f.follower_id === userId))
      .map((f) => (which === "followers" ? f.follower_id : f.following_id));
    return ids.map((id) => ({ id, name: demoName(id), username: null, avatar_url: null, is_following: mine.has(id) }));
  }
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
  if (isDemo) {
    const cs = clientStore();
    const s = cs.sessions.find((x) => x.id === sessionId && x.client_id === viewer);
    if (!s) return null;
    const sets = cs.sets.filter((x) => x.session_id === s.id);
    const load = loadOf(sets.map((x) => ({ ...x, exercise: x.exercise_name })), s.started_at, s.completed_at);
    const sharedPr = new Set(
      cs.posts.filter((p) => p.type === "pr" && p.activity_id === s.id && p.deleted_at === null && p.payload?.kind === "pr").map((p) => (p.payload as { exercise: string }).exercise),
    );
    return {
      session_id: s.id,
      name: s.day_name,
      date: s.started_at.slice(0, 10),
      duration_min: load.duration_min,
      exercises: load.exercises,
      sets: load.sets,
      volume_kg: load.volume_kg,
      load: load.score,
      prs: sets.filter((x) => x.is_pr).map((x) => ({
        set_id: x.id, exercise: x.exercise_name, weight_kg: x.weight_kg, reps: x.reps,
        estimated_1rm: estimated1RM(x.weight_kg, x.reps), shared: sharedPr.has(x.exercise_name),
      })),
      already_shared: cs.posts.some((p) => p.type === "workout" && p.activity_id === s.id && p.deleted_at === null),
    };
  }
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
