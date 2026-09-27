/**
 * The comment preview under a feed card, as data: which comments show, and
 * where "View all" goes. Pure — the database already chose the comments
 * (social_comment_preview: top-level, newest first, at most two, only ones
 * the reader may see); this only decides what the card does with them.
 * Tested in lib/comment-preview.test.ts.
 */
import { isPostId } from "@healthapp/shared";

export const COMMENT_PREVIEW_MAX = 2;

export type CommentPreviewModel<T> = {
  /** The comments to show, in the order the server sent them, at most two. */
  items: T[];
  /**
   * The "View all" line, or null when there is nothing to view. `count` is
   * the post's own comment_count — never the length of `items`.
   */
  viewAll: { href: string; count: number; one: boolean } | null;
};

/** Where a card's comments open: the post's own page, at its thread. */
export function commentsHref(postId: string): string | null {
  return isPostId(postId) ? `/feed/${postId.toLowerCase()}#comments` : null;
}

export function commentPreviewModel<T>(input: { postId: string; total: number; items: readonly T[] }): CommentPreviewModel<T> {
  const href = commentsHref(input.postId);
  const total = Number.isFinite(input.total) ? Math.max(0, Math.floor(input.total)) : 0;
  return {
    items: input.items.slice(0, COMMENT_PREVIEW_MAX),
    viewAll: href && total > 0 ? { href, count: total, one: total === 1 } : null,
  };
}
