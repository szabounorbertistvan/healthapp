/**
 * The numbers a comment thread shows, as data. Pure — the database already
 * decided what the reader may see (20261013100000: comment_count and
 * reply_count count only comments whose author is the reader or is listed for
 * them), so these only decide what to print. Tested in
 * lib/comment-thread-model.test.ts.
 */

type ThreadCounts = { reply_count: number; replies: readonly unknown[] };

function count(n: number | null | undefined): number | null {
  return typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.floor(n)) : null;
}

/**
 * The header total. The post's comment_count is the truth — it is the same
 * number the feed card's "View all N comments" printed, so opening the thread
 * never changes it — and it covers pages not loaded yet. What is on screen is
 * only a floor, for the moment between a write and the refresh that brings the
 * new count down.
 */
export function threadTotal(commentCount: number | null | undefined, threads: readonly ThreadCounts[]): number {
  const loaded = threads.reduce((sum, c) => sum + 1 + Math.max(count(c.reply_count) ?? 0, c.replies.length), 0);
  const server = count(commentCount);
  return server === null ? loaded : Math.max(server, loaded);
}

/** "Show N more replies": the visible replies not on screen yet. */
export function hiddenReplies(replyCount: number, shown: number): number {
  return Math.max(0, (count(replyCount) ?? 0) - Math.max(0, shown));
}
