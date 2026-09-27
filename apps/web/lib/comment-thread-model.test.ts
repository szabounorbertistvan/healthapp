import { describe, expect, it } from "vitest";
import { commentPreviewModel } from "./comment-preview";
import { hiddenReplies, threadTotal } from "./comment-thread-model";

const POST = "c2000000-0000-0000-0000-000000000001";

type Row = { id: string; parent: string | null; author: string };

/**
 * The server's rule, restated for the fixture only: a comment is visible when
 * its author is the reader or is listed (not suspended / deleting / blocked),
 * and a reply only under a visible parent. The real rule is SQL
 * (20261013100000); supabase/tests/social_comment_integrity.test.sql asserts
 * the same numbers against it — this checks what the UI does with them.
 */
function serverView(rows: Row[], reader: string, hidden: Set<string>, perRoot = 3) {
  const visible = (author: string) => author === reader || !hidden.has(author);
  const roots = rows.filter((r) => r.parent === null && visible(r.author));
  const repliesOf = (id: string) => rows.filter((r) => r.parent === id && visible(r.author));
  const threads = roots.map((r) => ({
    id: r.id,
    reply_count: repliesOf(r.id).length,
    replies: repliesOf(r.id).slice(0, perRoot),
  }));
  const comment_count = roots.reduce((n, r) => n + 1 + repliesOf(r.id).length, 0);
  return { threads, comment_count };
}

// The pgTAP thread: S's comment with eight replies, X / D / B / M's comments,
// one reply under X's. F reads; X suspended, D being deleted, B blocked F, F muted M.
const ROWS: Row[] = [
  { id: "11", parent: null, author: "S" },
  { id: "12", parent: null, author: "X" },
  { id: "13", parent: null, author: "D" },
  { id: "14", parent: null, author: "B" },
  { id: "15", parent: null, author: "M" },
  ...["F", "X", "B", "S", "D", "M", "S", "S"].map((author, i) => ({ id: `2${i + 1}`, parent: "11", author })),
  { id: "31", parent: "12", author: "S" },
];
const HIDDEN_FOR_F = new Set(["X", "D", "B"]); // M is muted — and still shown

describe("reply_count and comment_count — what the reader can see", () => {
  const view = serverView(ROWS, "F", HIDDEN_FOR_F);

  it("counts 7 for F, not the 14 stored: no X, D, B, and nothing under X's comment", () => {
    expect(view.comment_count).toBe(7);
    expect(threadTotal(view.comment_count, view.threads)).toBe(7);
  });

  it("reply_count under S's comment is the 5 visible replies", () => {
    expect(view.threads.find((t) => t.id === "11")?.reply_count).toBe(5);
  });

  it("mute does not hide M's comment", () => {
    expect(view.threads.map((t) => t.id)).toContain("15");
  });

  it("the thread header never adds hidden replies back", () => {
    // a stale reply_count from before this change would have said 8
    const stale = view.threads.map((t) => (t.id === "11" ? { ...t, reply_count: 8 } : t));
    expect(threadTotal(view.comment_count, view.threads)).toBe(7);
    expect(threadTotal(null, stale)).toBe(10);
  });

  it("the author sees their own comment even while suspended", () => {
    const own = serverView(ROWS, "X", new Set(["D", "B", "X"]));
    expect(own.threads.map((t) => t.id)).toContain("12");
    expect(threadTotal(own.comment_count, own.threads)).toBe(own.comment_count);
  });
});

describe("Show N more replies", () => {
  it("is the visible replies not on screen: 5 − 3 = 2", () => {
    expect(hiddenReplies(5, 3)).toBe(2);
  });
  it("disappears once everything is shown, and never goes negative", () => {
    expect(hiddenReplies(5, 5)).toBe(0);
    expect(hiddenReplies(2, 3)).toBe(0);
    expect(hiddenReplies(0, 0)).toBe(0);
  });
  it("tolerates a malformed count", () => {
    expect(hiddenReplies(Number.NaN, 1)).toBe(0);
    expect(hiddenReplies(4.9, 1)).toBe(3);
  });
  it("after paging in the rest, nothing is left to show", () => {
    const view = serverView(ROWS, "F", HIDDEN_FOR_F);
    const root = view.threads.find((t) => t.id === "11")!;
    const paged = ROWS.filter((r) => r.parent === "11" && !HIDDEN_FOR_F.has(r.author)).slice(3);
    expect(paged).toHaveLength(hiddenReplies(root.reply_count, root.replies.length));
    expect(hiddenReplies(root.reply_count, root.replies.length + paged.length)).toBe(0);
  });
});

describe("preview and thread agree", () => {
  const parity = (rows: Row[], reader: string, hidden: Set<string>) => {
    const view = serverView(rows, reader, hidden);
    const preview = commentPreviewModel({ postId: POST, total: view.comment_count, items: view.threads });
    return { preview: preview.viewAll?.count ?? 0, thread: threadTotal(view.comment_count, view.threads) };
  };

  it("many comments: the same number on the card and in the thread", () => {
    expect(parity(ROWS, "F", HIDDEN_FOR_F)).toEqual({ preview: 7, thread: 7 });
    expect(parity(ROWS, "A", new Set(["X", "D"]))).toEqual({ preview: 9, thread: 9 });
  });

  it("no comments: no 'View all' and a thread of 0", () => {
    expect(parity([], "F", HIDDEN_FOR_F)).toEqual({ preview: 0, thread: 0 });
    expect(commentPreviewModel({ postId: POST, total: 0, items: [] }).viewAll).toBeNull();
  });

  it("one comment: 'View all 1 comment' and a thread of 1", () => {
    const one = [{ id: "41", parent: null, author: "S" }];
    expect(parity(one, "F", HIDDEN_FOR_F)).toEqual({ preview: 1, thread: 1 });
    expect(commentPreviewModel({ postId: POST, total: 1, items: one }).viewAll?.one).toBe(true);
  });

  it("only a suspended or blocked author's comment: no 'View all' into an empty thread", () => {
    expect(parity([{ id: "42", parent: null, author: "X" }], "F", HIDDEN_FOR_F)).toEqual({ preview: 0, thread: 0 });
    expect(parity([{ id: "43", parent: null, author: "B" }], "F", HIDDEN_FOR_F)).toEqual({ preview: 0, thread: 0 });
  });

  it("the thread header keeps the card's number while only the first page is loaded", () => {
    const view = serverView(ROWS, "F", HIDDEN_FOR_F);
    expect(threadTotal(view.comment_count, view.threads.slice(0, 1))).toBe(7);
  });

  it("right after a new comment, before the refresh, the header does not go backwards", () => {
    const view = serverView(ROWS, "F", HIDDEN_FOR_F);
    const withNew = [...view.threads, { id: "new", reply_count: 0, replies: [] }];
    expect(threadTotal(view.comment_count, withNew)).toBe(8);
  });

  it("an empty page with no server count is 0", () => {
    expect(threadTotal(undefined, [])).toBe(0);
    expect(threadTotal(Number.NaN, [])).toBe(0);
  });
});
