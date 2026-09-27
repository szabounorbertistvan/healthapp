// Social feed — the rules the database enforces, mirrored here so the server
// actions and the UI agree: who may see a post, what a
// workout post is allowed to carry, how a page of the feed is cut, how text
// is validated. Nothing sensitive is derived here: a post's payload is a
// snapshot the author chose to publish, never a live read of their logs.

import type { ProgramPostPayload } from "./routines";
import type { AchievementPostPayload, FitnessScorePostPayload } from "./achievements";

export type PostType =
  | "workout" | "pr" | "challenge_completed" | "progress" | "text" | "streak" | "program"
  | "achievement" | "fitness_score" | "shared_post";
export type PostVisibility = "public" | "followers" | "private";
export type ReactionType = "kudos";

export const POST_TYPES: readonly PostType[] = [
  "workout", "pr", "challenge_completed", "progress", "text", "streak", "program", "achievement", "fitness_score",
  "shared_post",
];
export const POST_VISIBILITIES: readonly PostVisibility[] = ["public", "followers", "private"];

export const POST_TEXT_MAX = 500;
export const COMMENT_MAX = 500;
export const FEED_PAGE_SIZE = 20;
export const COMMENT_PAGE_SIZE = 20;

/**
 * Which posts the feed lists.
 *
 *   following  own posts and the people you follow — the original behaviour
 *   all        everything the visibility rules already allow
 *   mine       your own only
 *
 * A scope widens who is LISTED; it never widens what may be seen. The
 * visibility predicate is applied on top of all three, in SQL.
 */
export const FEED_SCOPES = ["following", "all", "mine"] as const;
export type FeedScope = (typeof FEED_SCOPES)[number];

export function isFeedScope(x: unknown): x is FeedScope {
  return typeof x === "string" && (FEED_SCOPES as readonly string[]).includes(x);
}

// ---------- payloads ----------
// What each post type publishes. Aggregates only for a workout: the feed and
// the future "share externally" card both read from this snapshot, so the
// backend never has to re-derive (or re-expose) the underlying sets.

export type WorkoutPostPayload = {
  kind: "workout";
  name: string;
  date: string;
  duration_min: number | null;
  exercises: number;
  sets: number;
  volume_kg: number;
  load: number;
  prs: number;
  /**
   * A picture the author chose to attach — the gym selfie people actually
   * want to post. Public Cloudinary URL (lib/cloudinary.ts), minted by the
   * server from an upload it signed, never a URL the browser supplied. Absent
   * on every post shared before this existed.
   */
  photo_url?: string | null;
};

export type PrPostPayload = {
  kind: "pr";
  exercise: string;
  weight_kg: number;
  reps: number;
  estimated_1rm: number;
  date: string;
  /**
   * Which set this is — sent when sharing, never stored: the database
   * (social_posts_guard, 20261012100000) finds the set, checks it is the
   * author's flagged PR, and rebuilds every number above from it.
   */
  set_id?: string;
};

export type ChallengePostPayload = {
  kind: "challenge_completed";
  title_en: string;
  title_ro: string;
  type: string;
  target: number;
  value: number;
};

export type ProgressPostPayload = {
  kind: "progress";
  /** Only present when the author explicitly chose to include it. */
  weight_kg?: number;
  /** storage path of a progress photo; null until photo sharing exists. */
  photo_path: string | null;
};

/**
 * A streak milestone: numbers only, snapshotted when shared. Says "30 day
 * streak" and nothing about what was lifted on any of those days.
 * (milestone, streak_start) is the once-only key the unique index enforces.
 */
export type StreakPostPayload = {
  kind: "streak";
  streak_days: number;
  milestone: number;
  /** The local day the milestone was reached. */
  achieved_at: string;
  streak_start: string;
  title: string;
};

/**
 * "Share to Voinic": a post that points at another post. Only the reference
 * travels — never a copy of the original's words or tile. The database
 * rebuilds this payload itself (social_posts_guard): it resolves a share of
 * a share to the original, and refuses anything the sharer may not see.
 * Readers see the original only while THEY may see it, so deleting or
 * hiding the original empties every share of it.
 */
export type SharedPostPayload = {
  kind: "shared_post";
  original_post_id: string;
};

export type PostPayload =
  | WorkoutPostPayload | PrPostPayload | ChallengePostPayload | ProgressPostPayload | StreakPostPayload
  | ProgramPostPayload | AchievementPostPayload | FitnessScorePostPayload | SharedPostPayload | null;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The id shape Postgres gives every post. Anything else is not a post id. */
export function isPostId(v: unknown): v is string {
  return typeof v === "string" && UUID.test(v);
}

/** The payload of a share: the original's id and nothing else. Null for a malformed id. */
export function sharedPostPayload(originalPostId: string): SharedPostPayload | null {
  return isPostId(originalPostId) ? { kind: "shared_post", original_post_id: originalPostId.toLowerCase() } : null;
}

/**
 * A data post's payload names its own type (social_posts_guard enforces the
 * same in SQL): a 'pr' post cannot carry a workout tile, and a text post has
 * no payload at all.
 */
export function payloadMatchesType(type: PostType, payload: PostPayload): boolean {
  if (type === "text") return payload === null;
  // A share is nothing but its reference: no payload, or extra keys, is not a share.
  if (type === "shared_post") {
    return payload !== null && payload.kind === "shared_post"
      && Object.keys(payload).length === 2 && isPostId(payload.original_post_id);
  }
  return payload === null || payload.kind === type;
}

/**
 * The request to share one PR: the set it is, plus the snapshot fields the
 * type needs. The database (social_posts_guard) finds the set by `set_id`,
 * checks it is the author's own flagged PR in the named session, rebuilds
 * every number from it and drops `set_id` — the numbers here are never
 * what gets stored.
 */
export function prPostPayload(
  pr: { set_id: string; exercise: string; weight_kg: number; reps: number; estimated_1rm: number },
  date: string,
): PrPostPayload {
  return {
    kind: "pr",
    exercise: pr.exercise,
    weight_kg: pr.weight_kg,
    reps: pr.reps,
    estimated_1rm: pr.estimated_1rm,
    date,
    set_id: pr.set_id,
  };
}

/** Build a workout post from a scored session. Only aggregates cross into the feed. */
export function workoutPostPayload(session: {
  name: string;
  date: string;
  duration_min: number | null;
  exercises: number;
  sets: number;
  volume_kg: number;
  load: number;
  prs: number;
  photo_url?: string | null;
}): WorkoutPostPayload {
  return {
    kind: "workout",
    name: session.name.trim() || "Workout",
    date: session.date,
    duration_min: session.duration_min,
    exercises: Math.max(0, Math.round(session.exercises)),
    sets: Math.max(0, Math.round(session.sets)),
    volume_kg: Math.max(0, Math.round(session.volume_kg)),
    load: Math.min(100, Math.max(0, Math.round(session.load))),
    prs: Math.max(0, Math.round(session.prs)),
    // Only ever https, and only ever a string: a payload key the feed renders
    // into an <img src> is the one place a stray value would be visible.
    photo_url: typeof session.photo_url === "string" && session.photo_url.startsWith("https://")
      ? session.photo_url
      : null,
  };
}

/** The keys a workout payload must never carry — a guard for the share pipeline. */
const FORBIDDEN_PAYLOAD_KEYS = ["weight", "body_weight", "body_fat", "kcal", "calories", "circumferences", "waist", "sets_detail"];

export function payloadIsSafe(payload: unknown): boolean {
  if (payload === null || typeof payload !== "object") return payload === null;
  const keys = Object.keys(payload as Record<string, unknown>);
  const kind = (payload as { kind?: string }).kind;
  // weight_kg is the LIFTED weight on a PR post, and body weight on a progress
  // post only because the author opted in; a workout post never carries it.
  return keys.every((k) => !FORBIDDEN_PAYLOAD_KEYS.includes(k) && (k !== "weight_kg" || kind === "progress" || kind === "pr"));
}

// ---------- visibility ----------

export type PostLike = { id: string; user_id: string; visibility: PostVisibility; created_at: string; deleted_at: string | null };

/** The SQL policy, in TypeScript: own, public, or followers-only when the viewer follows the author. */
export function canSeePost(post: PostLike, viewerId: string, follows: ReadonlySet<string>): boolean {
  if (post.deleted_at !== null) return false;
  if (post.user_id === viewerId) return true;
  if (post.visibility === "public") return true;
  if (post.visibility === "followers") return follows.has(post.user_id);
  return false;
}

/** The home feed: own posts and the people you follow, newest first, one page at a time. */
export function feedPage<T extends PostLike>(
  posts: readonly T[],
  viewerId: string,
  follows: ReadonlySet<string>,
  opts: { before?: string | null; limit?: number } = {},
): { items: T[]; nextCursor: string | null } {
  const limit = Math.max(1, opts.limit ?? FEED_PAGE_SIZE);
  const visible = posts
    .filter((p) => (p.user_id === viewerId || follows.has(p.user_id)) && canSeePost(p, viewerId, follows))
    .filter((p) => !opts.before || p.created_at < opts.before)
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
  const items = visible.slice(0, limit);
  const last = items[items.length - 1];
  return { items, nextCursor: visible.length > limit && last ? last.created_at : null };
}

// ---------- follows ----------

export type FollowError = "self" | "duplicate";

export function validateFollow(followerId: string, followingId: string, existing: ReadonlySet<string>): FollowError | null {
  if (followerId === followingId) return "self";
  if (existing.has(followingId)) return "duplicate";
  return null;
}

// ---------- text ----------

/**
 * Plain text only: trimmed, control characters dropped, length capped. HTML
 * is never interpreted (React escapes on render), so it is left as literal
 * characters rather than stripped — "<3" is a valid thing to say.
 */
export function cleanText(input: string, max: number): string | null {
  const text = input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").trim();
  if (text.length === 0 || text.length > max) return null;
  return text;
}

export function validatePostText(input: string): string | null {
  return cleanText(input, POST_TEXT_MAX);
}

/**
 * A caption edit. A text post is its text, so it keeps 1–500 characters; a
 * data post (workout, PR, badge…) is its snapshot, so its caption may be
 * cleared entirely. `ok: false` means refuse; `text: null` means "no caption".
 */
export function validatePostEdit(type: PostType, input: string): { ok: true; text: string | null } | { ok: false } {
  if (input.trim().length === 0 && type !== "text") return { ok: true, text: null };
  const clean = validatePostText(input);
  return clean ? { ok: true, text: clean } : { ok: false };
}

export function validateComment(input: string): string | null {
  return cleanText(input, COMMENT_MAX);
}

// ---------- kudos ----------

export const KUDOS_PAGE_SIZE = 20;

/**
 * Who may give kudos: anyone who can see the post, except its author. The
 * SQL policy (reactions_insert → can_kudos_post) and the server action both
 * apply this, so a self-kudos is refused before it reaches the database.
 */
export type KudosError = "not_visible" | "self";

export function canKudos(post: PostLike, viewerId: string, follows: ReadonlySet<string>): KudosError | null {
  if (!canSeePost(post, viewerId, follows)) return "not_visible";
  if (post.user_id === viewerId) return "self";
  return null;
}

/**
 * "Norbert, Maria and 12 others" — the count plus the first one or two names
 * the feed row already carries (kudos_names), so the card never asks for more.
 */
export function kudosSummary(
  count: number,
  names: readonly string[],
): { count: number; others: number; first: string | null; second: string | null } {
  const [first = null, second = null] = names.filter((n) => n.trim().length > 0).slice(0, 2);
  if (count <= 0 || first === null) return { count, others: 0, first: null, second: null };
  const shown = second !== null && count >= 2 ? second : null;
  return { count, others: Math.max(0, count - (shown === null ? 1 : 2)), first, second: shown };
}

/** The flip the card shows before the server answers. Applying it twice restores the input. */
export function toggleKudosState(state: { my_kudos: boolean; kudos_count: number }): { my_kudos: boolean; kudos_count: number } {
  return { my_kudos: !state.my_kudos, kudos_count: Math.max(0, state.kudos_count + (state.my_kudos ? -1 : 1)) };
}

// ---------- following ----------

/**
 * What the follow button says, from the two real edges social_profile /
 * social_follow_list return. Someone who follows you and whom you do not
 * follow gets "Follow back"; the relationship itself ("Follows you",
 * "Mutual") is the chip beside it — see followState().
 */
export type FollowButtonState = "follow" | "follow_back" | "following";

export function followButtonState(p: { is_following: boolean; follows_me?: boolean | null }): FollowButtonState {
  if (p.is_following) return "following";
  return p.follows_me ? "follow_back" : "follow";
}
