// Query-string parsing for the admin pages. Pure, so it is unit-tested.
//
// Every list page is a GET form: filters, sort and page live in the URL so a
// view can be reloaded or linked. Nothing here reaches the database as text —
// each value is checked against an allow-list (or parsed as a bounded number)
// and the RPCs re-check on their side. An unknown value is dropped, never
// forwarded.

export const USER_ROLES = ["client", "coach", "admin"] as const;
export const USER_STATUSES = ["active", "inactive", "suspended", "deletion"] as const;
export const USER_COACH = ["with", "without"] as const;
export const USER_SORTS = ["newest", "oldest", "last_active", "most_workouts", "most_sets", "name"] as const;
export const INVITATION_STATUSES = ["pending", "accepted", "expired", "ended"] as const;
export const POST_STATUSES = ["live", "deleted"] as const;
export const POST_TYPES = ["workout", "pr", "challenge_completed", "progress", "text", "streak"] as const;
export const POST_VISIBILITIES = ["public", "followers", "private"] as const;
export const EXERCISE_OWNERS = ["system", "custom"] as const;
export const EXERCISE_SOURCES = ["free-exercise-db", "custom"] as const;
export const AUDIT_ACTIONS = [
  "USER_CREATED", "USER_LOGIN", "LOGIN_FAILED", "ROLE_CHANGED",
  "USER_SUSPENDED", "USER_REACTIVATED", "ACCOUNT_DELETION_REQUESTED", "TIER_CHANGED",
  "INVITATION_CREATED", "INVITATION_ACCEPTED", "INVITATION_REVOKED", "RELATIONSHIP_ENDED",
  "PROGRAM_CREATED", "PROGRAM_UPDATED", "PROGRAM_DELETED",
  "WORKOUT_STARTED", "WORKOUT_COMPLETED", "WORKOUT_DELETED",
  "SET_LOGGED", "SET_EDITED", "SET_DELETED",
  "EXERCISE_CREATED", "EXERCISE_UPDATED", "EXERCISE_DELETED",
  "CHALLENGE_CREATED", "CHALLENGE_JOINED", "CHALLENGE_COMPLETED",
  "POST_CREATED", "POST_DELETED", "COMMENT_CREATED", "COMMENT_DELETED",
  "KUDOS_ADDED", "KUDOS_REMOVED", "FOLLOW_CREATED", "FOLLOW_REMOVED",
  "PUSH_SUBSCRIBED", "PUSH_UNSUBSCRIBED",
  "ADMIN_ACTION",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** Page sizes the lists use; the RPCs clamp to 100/200 on their side too. */
export const PAGE_SIZE = 25;
export const AUDIT_PAGE_SIZE = 50;
export const DAY_WINDOWS = [7, 14, 30, 90] as const;

export type Search = Record<string, string | string[] | undefined>;

/** The first value of a query key, trimmed, or null. */
export function str(params: Search, key: string): string | null {
  const raw = params[key];
  const v = Array.isArray(raw) ? raw[0] : raw;
  const s = v?.trim();
  return s ? s : null;
}

/** A query value that must be one of `allowed`; anything else is null. */
export function oneOf<T extends string>(params: Search, key: string, allowed: readonly T[]): T | null {
  const v = str(params, key);
  return v && (allowed as readonly string[]).includes(v) ? (v as T) : null;
}

/** A positive integer page number; anything else is page 1. */
export function pageOf(params: Search): number {
  const n = Number(str(params, "page"));
  return Number.isInteger(n) && n >= 1 ? Math.min(n, 100000) : 1;
}

/** A bounded integer (days, limits). Null when absent or out of range. */
export function intOf(params: Search, key: string, min: number, max: number): number | null {
  const v = str(params, key);
  if (v === null) return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

/** The days window of an analytics page: one of DAY_WINDOWS, default 30. */
export function daysOf(params: Search): number {
  const n = intOf(params, "days", 1, 365);
  return n && (DAY_WINDOWS as readonly number[]).includes(n) ? n : 30;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A route or query id that must be a UUID; anything else is null. */
export function uuidOf(value: string | null | undefined): string | null {
  const v = value?.trim();
  return v && UUID.test(v) ? v.toLowerCase() : null;
}

/** A free-text search term, length-capped so it cannot become a giant ILIKE. */
export function searchOf(params: Search, key = "q"): string | null {
  const v = str(params, key);
  return v ? v.slice(0, 120) : null;
}

/**
 * Rebuild a list URL from the current filters with some keys changed. Empty
 * values drop the key; `page: 1` is omitted because it is the default.
 */
export function listHref(base: string, current: Record<string, string | number | null | undefined>, next: Record<string, string | number | null | undefined> = {}): string {
  const merged: Record<string, string | number | null | undefined> = { ...current, ...next };
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) {
    if (v === null || v === undefined || v === "") continue;
    if (k === "page" && Number(v) <= 1) continue;
    qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `${base}?${s}` : base;
}

/** Page math shared by every paginated list. */
export function paging(total: number, page: number, size: number): { pages: number; first: number; last: number; offset: number } {
  const pages = Math.max(1, Math.ceil(total / size));
  const p = Math.min(page, pages);
  const offset = (p - 1) * size;
  return { pages, first: total === 0 ? 0 : offset + 1, last: Math.min(total, offset + size), offset };
}
