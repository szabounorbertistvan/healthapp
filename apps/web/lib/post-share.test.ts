import { describe, expect, it } from "vitest";
import { payloadMatchesType, sharedPostPayload } from "@healthapp/shared";
import { canRepost, canWebShare, postShareUrl, saveReducer, sharedView, shareTargets, type SaveState } from "./post-share";

const ID = "3d000000-0000-0000-0000-000000000002";

describe("postShareUrl", () => {
  it("builds the post's own page on the page's origin", () => {
    expect(postShareUrl("https://www.voinic.fit", ID)).toBe(`https://www.voinic.fit/feed/${ID}`);
    expect(postShareUrl("http://localhost:3000/some/path?x=1", ID)).toBe(`http://localhost:3000/feed/${ID}`);
  });
  it("refuses anything that is not a post id", () => {
    expect(postShareUrl("https://www.voinic.fit", "../admin")).toBeNull();
    expect(postShareUrl("https://www.voinic.fit", `${ID}?next=evil`)).toBeNull();
  });
  it("refuses origins that are not web pages", () => {
    expect(postShareUrl("javascript:alert(1)", ID)).toBeNull();
    expect(postShareUrl("not a url", ID)).toBeNull();
  });
});

describe("share targets and the Web Share fallback", () => {
  it("always offers Copy link", () => {
    expect(shareTargets({ webShare: false, canRepost: false })).toEqual(["copy"]);
  });
  it("adds Share to Voinic and the system sheet only when they can work", () => {
    expect(shareTargets({ webShare: true, canRepost: true })).toEqual(["copy", "voinic", "external"]);
    expect(shareTargets({ webShare: false, canRepost: true })).toEqual(["copy", "voinic"]);
  });
  it("never assumes navigator.share exists", () => {
    expect(canWebShare(undefined, "https://x.test")).toBe(false);
    expect(canWebShare({}, "https://x.test")).toBe(false);
    expect(canWebShare({ share: () => undefined }, "https://x.test")).toBe(true);
    expect(canWebShare({ share: () => undefined, canShare: () => false }, "https://x.test")).toBe(false);
    expect(canWebShare({ share: () => undefined, canShare: () => { throw new Error("no"); } }, "https://x.test")).toBe(false);
  });
});

describe("canRepost", () => {
  it("is never offered on your own post", () => {
    expect(canRepost({ mine: true, type: "workout", shared: null })).toBe(false);
  });
  it("is offered on someone else's post, and on a share while its original is visible", () => {
    expect(canRepost({ mine: false, type: "pr", shared: null })).toBe(true);
    expect(canRepost({ mine: false, type: "shared_post", shared: { id: ID } })).toBe(true);
    expect(canRepost({ mine: false, type: "shared_post", shared: null })).toBe(false);
  });
});

describe("repost payload validation", () => {
  it("is the reference and nothing else", () => {
    expect(sharedPostPayload(ID)).toEqual({ kind: "shared_post", original_post_id: ID });
    expect(sharedPostPayload("../admin")).toBeNull();
    expect(payloadMatchesType("shared_post", { kind: "shared_post", original_post_id: ID })).toBe(true);
  });
  it("refuses a share without a reference, with extra keys, or posing as another type", () => {
    expect(payloadMatchesType("shared_post", null)).toBe(false);
    expect(payloadMatchesType("shared_post", { kind: "shared_post", original_post_id: "nope" })).toBe(false);
    expect(payloadMatchesType("shared_post",
      { kind: "shared_post", original_post_id: ID, name: "Fake" } as unknown as ReturnType<typeof sharedPostPayload>)).toBe(false);
    expect(payloadMatchesType("workout", { kind: "shared_post", original_post_id: ID })).toBe(false);
  });
});

describe("saveReducer — optimistic, one in flight, rolled back on failure", () => {
  const idle: SaveState = { saved: false, pending: false, error: false };

  it("flips at once on a tap and marks the request in flight", () => {
    expect(saveReducer(idle, { type: "tap" })).toEqual({ saved: true, pending: true, error: false });
  });
  it("ignores a second tap while one request is out", () => {
    const inFlight = saveReducer(idle, { type: "tap" });
    expect(saveReducer(inFlight, { type: "tap" })).toBe(inFlight);
  });
  it("keeps the new state when the server agrees", () => {
    const inFlight = saveReducer(idle, { type: "tap" });
    expect(saveReducer(inFlight, { type: "done", ok: true })).toEqual({ saved: true, pending: false, error: false });
  });
  it("rolls back and says so when the server refuses", () => {
    const inFlight = saveReducer(idle, { type: "tap" });
    expect(saveReducer(inFlight, { type: "done", ok: false })).toEqual({ saved: false, pending: false, error: true });
  });
  it("unsaving rolls back to saved on failure", () => {
    const saved: SaveState = { saved: true, pending: false, error: false };
    const out = saveReducer(saved, { type: "tap" });
    expect(out.saved).toBe(false);
    expect(saveReducer(out, { type: "done", ok: false }).saved).toBe(true);
  });
  it("takes the server's value after a refresh, but not over a request in flight", () => {
    expect(saveReducer(idle, { type: "sync", saved: true }).saved).toBe(true);
    const inFlight = saveReducer(idle, { type: "tap" });
    expect(saveReducer(inFlight, { type: "sync", saved: false })).toBe(inFlight);
  });
});

describe("sharedView — a deleted original is never invented", () => {
  it("shows the original only when the server returned it", () => {
    expect(sharedView({ type: "shared_post", shared: { id: ID } })).toBe("original");
    expect(sharedView({ type: "shared_post", shared: null })).toBe("unavailable");
    expect(sharedView({ type: "workout", shared: null })).toBe("none");
  });
});
