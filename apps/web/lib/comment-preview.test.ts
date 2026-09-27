import { describe, expect, it } from "vitest";
import { commentPreviewModel, commentsHref } from "./comment-preview";

const POST = "2d000000-0000-0000-0000-000000000001";
const c = (id: string) => ({ id });

describe("commentPreviewModel", () => {
  it("0 comments: nothing to show, no View all", () => {
    expect(commentPreviewModel({ postId: POST, total: 0, items: [] })).toEqual({ items: [], viewAll: null });
  });

  it("1 comment: that comment, and a View all for one", () => {
    const m = commentPreviewModel({ postId: POST, total: 1, items: [c("a")] });
    expect(m.items).toEqual([c("a")]);
    expect(m.viewAll).toEqual({ href: `/feed/${POST}#comments`, count: 1, one: true });
  });

  it("2 comments: both", () => {
    expect(commentPreviewModel({ postId: POST, total: 2, items: [c("b"), c("a")] }).items).toEqual([c("b"), c("a")]);
  });

  it("10 comments: two shown, the total is the server's ten", () => {
    const m = commentPreviewModel({ postId: POST, total: 10, items: [c("j"), c("i")] });
    expect(m.items).toHaveLength(2);
    expect(m.viewAll?.count).toBe(10);
    expect(m.viewAll?.one).toBe(false);
  });

  it("never shows more than two, whatever it is handed", () => {
    expect(commentPreviewModel({ postId: POST, total: 5, items: [c("e"), c("d"), c("c")] }).items).toEqual([c("e"), c("d")]);
  });

  it("keeps the server's order (newest first) as given", () => {
    expect(commentPreviewModel({ postId: POST, total: 3, items: [c("newest"), c("older")] }).items.map((x) => x.id))
      .toEqual(["newest", "older"]);
  });

  it("the count is not derived from the preview: comments by hidden authors still count", () => {
    // The server hid the only comment (author suspended), but the post has one.
    const m = commentPreviewModel({ postId: POST, total: 1, items: [] });
    expect(m.items).toEqual([]);
    expect(m.viewAll?.count).toBe(1);
  });

  it("a nonsense total reads as none", () => {
    expect(commentPreviewModel({ postId: POST, total: Number.NaN, items: [] }).viewAll).toBeNull();
    expect(commentPreviewModel({ postId: POST, total: -3, items: [] }).viewAll).toBeNull();
  });
});

describe("commentsHref", () => {
  it("is the post's own page at its thread", () => {
    expect(commentsHref(POST)).toBe(`/feed/${POST}#comments`);
  });
  it("refuses anything that is not a post id", () => {
    expect(commentsHref("../admin")).toBeNull();
    expect(commentsHref(`${POST}#x`)).toBeNull();
  });
});
