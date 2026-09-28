import { describe, expect, it } from "vitest";
import {
  EMPTY_DRAFT,
  draftBusy,
  draftCounter,
  draftUploadedIds,
  mediaDraftReducer as r,
  publishPlan,
  type MediaDraft,
} from "./media-draft";

const pid = (n: number) => `voinic/posts/u/m-${n}`;

/** A draft with n pictures, each prepared and uploaded. */
function ready(n: number): MediaDraft {
  let s = r(EMPTY_DRAFT, { type: "add", keys: Array.from({ length: n }, (_, i) => `k${i}`) });
  for (let i = 0; i < n; i++) {
    s = r(s, { type: "prepared", key: `k${i}`, previewUrl: `blob:${i}`, width: 1080, height: 1350 });
    s = r(s, { type: "uploaded", key: `k${i}`, publicId: pid(i) });
  }
  return s;
}
const keys = (s: MediaDraft) => s.items.map((i) => i.key).join(",");

describe("picking", () => {
  it("adds pictures as preparing, and says loading", () => {
    const s = r(EMPTY_DRAFT, { type: "add", keys: ["a", "b"] });
    expect(s.items.map((i) => i.status)).toEqual(["preparing", "preparing"]);
    expect(draftBusy(s)).toBe(true);
    expect(draftCounter(s)).toBe("2/10");
  });
  it("never holds more than ten, and counts what did not fit", () => {
    const s = r(ready(8), { type: "add", keys: ["x", "y", "z"] });
    expect(s.items).toHaveLength(10);
    expect(s.overflow).toBe(1);
    expect(r(s, { type: "add", keys: ["w"] }).items).toHaveLength(10);
  });
  it("shows no counter when empty", () => expect(draftCounter(EMPTY_DRAFT)).toBeNull());
});

describe("uploading", () => {
  it("goes preparing → uploading → ready", () => {
    let s = r(EMPTY_DRAFT, { type: "add", keys: ["a"] });
    s = r(s, { type: "prepared", key: "a", previewUrl: "blob:a", width: 1600, height: 900 });
    expect(s.items[0]!.status).toBe("uploading");
    expect(s.items[0]!.previewUrl).toBe("blob:a");
    s = r(s, { type: "uploaded", key: "a", publicId: pid(1) });
    expect(s.items[0]!).toMatchObject({ status: "ready", publicId: pid(1), width: 1600, height: 900 });
    expect(draftBusy(s)).toBe(false);
  });
  it("marks an upload error, and a retry sends it again", () => {
    let s = r(EMPTY_DRAFT, { type: "add", keys: ["a"] });
    s = r(s, { type: "prepared", key: "a", previewUrl: "blob:a", width: 10, height: 10 });
    s = r(s, { type: "failed", key: "a", failure: "upload" });
    expect(s.items[0]!).toMatchObject({ status: "failed", failure: "upload" });
    s = r(s, { type: "retry", key: "a" });
    expect(s.items[0]!).toMatchObject({ status: "uploading", failure: null });
    s = r(s, { type: "uploaded", key: "a", publicId: pid(1) });
    expect(s.items[0]!.status).toBe("ready");
  });
  it("does not retry a file that was not a photo", () => {
    let s = r(EMPTY_DRAFT, { type: "add", keys: ["a"] });
    s = r(s, { type: "rejected", key: "a", failure: "type" });
    expect(r(s, { type: "retry", key: "a" })).toBe(s);
  });
  it("ignores an upload that lands after its picture was removed", () => {
    let s = r(EMPTY_DRAFT, { type: "add", keys: ["a"] });
    s = r(s, { type: "prepared", key: "a", previewUrl: "blob:a", width: 10, height: 10 });
    s = r(s, { type: "remove", key: "a" });
    expect(r(s, { type: "uploaded", key: "a", publicId: pid(1) })).toBe(s);
  });
});

describe("arranging", () => {
  it("removes one picture and keeps the rest in order", () => {
    const s = r(ready(3), { type: "remove", key: "k1" });
    expect(keys(s)).toBe("k0,k2");
  });
  it("moves a picture one step, within the ends", () => {
    expect(keys(r(ready(3), { type: "move", key: "k0", delta: 1 }))).toBe("k1,k0,k2");
    expect(keys(r(ready(3), { type: "move", key: "k2", delta: -1 }))).toBe("k0,k2,k1");
    const s = ready(3);
    expect(r(s, { type: "move", key: "k0", delta: -1 })).toBe(s);
    expect(r(s, { type: "move", key: "k2", delta: 1 })).toBe(s);
  });
  it("drags a picture to a position", () => {
    expect(keys(r(ready(4), { type: "moveTo", key: "k3", index: 0 }))).toBe("k3,k0,k1,k2");
    expect(keys(r(ready(4), { type: "moveTo", key: "k0", index: 99 }))).toBe("k1,k2,k3,k0");
  });
  it("keeps alt text per picture", () => {
    const s = r(ready(2), { type: "alt", key: "k1", alt: "deadlift" });
    expect(s.items.map((i) => i.alt)).toEqual(["", "deadlift"]);
  });
});

describe("cancel and publish", () => {
  it("cancel knows every upload that reached storage", () => {
    let s = ready(2);
    s = r(s, { type: "add", keys: ["late"] });
    expect(draftUploadedIds(s)).toEqual([pid(0), pid(1)]);
    expect(r(s, { type: "reset" })).toEqual(EMPTY_DRAFT);
  });
  it("publishes the pictures in their order, with optional alt text", () => {
    let s = r(ready(2), { type: "move", key: "k1", delta: -1 });
    s = r(s, { type: "alt", key: "k0", alt: "  bench  " });
    expect(publishPlan(s, "")).toEqual({
      ok: true,
      media: [
        { publicId: pid(1), width: 1080, height: 1350, alt: null },
        { publicId: pid(0), width: 1080, height: 1350, alt: "bench" },
      ],
    });
  });
  it("words alone are a post; nothing is not", () => {
    expect(publishPlan(EMPTY_DRAFT, "leg day")).toEqual({ ok: true, media: [] });
    expect(publishPlan(EMPTY_DRAFT, "   ")).toEqual({ ok: false, reason: "empty" });
  });
  it("waits for uploads, and never drops a failed picture silently", () => {
    expect(publishPlan(r(ready(1), { type: "add", keys: ["x"] }), "hi")).toEqual({ ok: false, reason: "busy" });
    let s = r(ready(1), { type: "add", keys: ["x"] });
    s = r(s, { type: "rejected", key: "x", failure: "size" });
    expect(publishPlan(s, "hi")).toEqual({ ok: false, reason: "failed" });
    expect(publishPlan(r(s, { type: "remove", key: "x" }), "hi").ok).toBe(true);
  });
});
