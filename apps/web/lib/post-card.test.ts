import { describe, expect, it } from "vitest";
import {
  CAPTION_FOLD_CHARS, captionFolds, doubleTapGives, giveNeedsUndo, isDoubleTap, postAge, splitHashtags,
} from "./post-card";

const NOW = Date.parse("2026-09-27T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("postAge", () => {
  it("reads under a minute, and the future, as now", () => {
    expect(postAge(ago(30_000), NOW)).toEqual({ unit: "now" });
    expect(postAge(ago(-5 * MIN), NOW)).toEqual({ unit: "now" });
  });
  it("counts minutes, then hours", () => {
    expect(postAge(ago(2 * MIN), NOW)).toEqual({ unit: "minutes", n: 2 });
    expect(postAge(ago(59 * MIN), NOW)).toEqual({ unit: "minutes", n: 59 });
    expect(postAge(ago(HOUR), NOW)).toEqual({ unit: "hours", n: 1 });
    expect(postAge(ago(23 * HOUR + 59 * MIN), NOW)).toEqual({ unit: "hours", n: 23 });
  });
  it("says yesterday for the second day, days for the rest of the week, then a date", () => {
    expect(postAge(ago(DAY), NOW)).toEqual({ unit: "yesterday" });
    expect(postAge(ago(2 * DAY), NOW)).toEqual({ unit: "days", n: 2 });
    expect(postAge(ago(6 * DAY + 23 * HOUR), NOW)).toEqual({ unit: "days", n: 6 });
    expect(postAge(ago(7 * DAY), NOW)).toEqual({ unit: "date" });
  });
  it("treats an unparseable timestamp as now rather than NaN", () => {
    expect(postAge("not a date", NOW)).toEqual({ unit: "now" });
  });
});

describe("splitHashtags", () => {
  const tags = (s: string) => splitHashtags(s).filter((p) => p.kind === "tag").map((p) => p.text);

  it("finds tags and keeps every character, in order", () => {
    const text = "Chest day. #chestday #benchpress, #fitness!";
    const pieces = splitHashtags(text);
    expect(pieces.map((p) => p.text).join("")).toBe(text);
    expect(tags(text)).toEqual(["#chestday", "#benchpress", "#fitness"]);
  });
  it("takes letters in any script", () => {
    expect(tags("#picioare #ziuaDeSpate #ăîșț")).toEqual(["#picioare", "#ziuaDeSpate", "#ăîșț"]);
  });
  it("ignores a # glued to a word, an entity or a url fragment", () => {
    expect(tags("abc#def &#39; example.com/#anchor")).toEqual([]);
  });
  it("ignores numbers-only tags such as ranks", () => {
    expect(tags("Finished #1 in the challenge")).toEqual([]);
  });
  it("returns text as-is when there is nothing to split, and nothing for empty text", () => {
    expect(splitHashtags("no tags <b>here</b>")).toEqual([{ kind: "text", text: "no tags <b>here</b>" }]);
    expect(splitHashtags("")).toEqual([]);
  });
});

describe("captionFolds", () => {
  it("leaves empty and short captions open", () => {
    expect(captionFolds(null)).toBe(false);
    expect(captionFolds("")).toBe(false);
    expect(captionFolds("New PR today.")).toBe(false);
    expect(captionFolds("x".repeat(CAPTION_FOLD_CHARS))).toBe(false);
  });
  it("folds long captions and tall ones", () => {
    expect(captionFolds("x".repeat(CAPTION_FOLD_CHARS + 1))).toBe(true);
    expect(captionFolds("a\nb\nc\nd")).toBe(true);
  });
});

describe("double tap", () => {
  it("gives only when not given, not own, not in flight", () => {
    expect(doubleTapGives({ mine: false, given: false, pending: false })).toBe(true);
    expect(doubleTapGives({ mine: false, given: true, pending: false })).toBe(false);
    expect(doubleTapGives({ mine: true, given: false, pending: false })).toBe(false);
    expect(doubleTapGives({ mine: false, given: false, pending: true })).toBe(false);
  });
  it("undoes a give that the server answered as a removal", () => {
    expect(giveNeedsUndo({ ok: true, kudos: false })).toBe(true);
    expect(giveNeedsUndo({ ok: true, kudos: true })).toBe(false);
    expect(giveNeedsUndo({ ok: false })).toBe(false);
  });
  it("pairs two close taps and nothing else", () => {
    const a = { t: 1000, x: 100, y: 100 };
    expect(isDoubleTap(null, a)).toBe(false);
    expect(isDoubleTap(a, { t: 1250, x: 110, y: 105 })).toBe(true);
    expect(isDoubleTap(a, { t: 1400, x: 100, y: 100 })).toBe(false);
    expect(isDoubleTap(a, { t: 1100, x: 200, y: 100 })).toBe(false);
  });
});
