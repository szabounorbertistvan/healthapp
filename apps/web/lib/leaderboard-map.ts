/**
 * A board as the server sent it, split for the page. Pure, so vitest covers
 * it (lib/leaderboard-map.test.ts).
 *
 * social_leaderboard() already chose which rows the caller sees: the top N
 * visible rows, in rank order, plus the caller's own row when it ranks below
 * them. Since 20261010100000 a blocked person's row is left out AFTER the
 * ranking, so the ranks it sends can skip a number (1, 2, 4, …) and the top N
 * reaches past rank N. The page must therefore take the server's rows as
 * they are — never re-filter them by rank number, never renumber them, never
 * re-sort them by score.
 */

import { isPostId } from "@healthapp/shared";

export type BoardRow = { rank: number; user_id: string; is_current_user: boolean };

export function splitBoard<T extends BoardRow>(rows: readonly T[], top: number): { entries: T[]; me: T | null; total: number } {
  // The server sends at most `top` rows plus, possibly, the caller's own row
  // after them; anything past `top` can only be that row.
  const entries = rows.slice(0, Math.max(0, top));
  return {
    entries,
    me: rows.find((r) => r.is_current_user) ?? null,
    total: rows.reduce((max, r) => Math.max(max, r.rank), 0),
  };
}

/** Where a board row links: the person's profile, which applies block itself. Null for a malformed id. */
export function boardRowHref(userId: string): string | null {
  return isPostId(userId) ? `/people/${userId.toLowerCase()}` : null;
}
