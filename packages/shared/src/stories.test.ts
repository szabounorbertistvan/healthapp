import { describe, expect, it } from "vitest";
import {
  STORY_TEXT_MAX,
  firstUnseenIndex,
  isStoryBackground,
  isStoryLive,
  nextStoryPos,
  prevStoryPos,
  storyDurationMs,
  validateStoryText,
} from "./stories";

describe("validateStoryText — mirrors the check constraint on social_stories.body", () => {
  it("trims and keeps 1–200 characters", () => {
    expect(validateStoryText("  Leg day done  ")).toEqual({ ok: true, text: "Leg day done" });
    expect(validateStoryText("x".repeat(STORY_TEXT_MAX))).toEqual({ ok: true, text: "x".repeat(STORY_TEXT_MAX) });
  });
  it("refuses blank, too long and non-text", () => {
    expect(validateStoryText("   ")).toEqual({ ok: false });
    expect(validateStoryText("x".repeat(STORY_TEXT_MAX + 1))).toEqual({ ok: false });
    expect(validateStoryText(null)).toEqual({ ok: false });
  });
});

describe("isStoryBackground", () => {
  it("knows the three backgrounds and nothing else", () => {
    expect(isStoryBackground("gold")).toBe(true);
    expect(isStoryBackground("night")).toBe(true);
    expect(isStoryBackground("paper")).toBe(true);
    expect(isStoryBackground("red")).toBe(false);
    expect(isStoryBackground(undefined)).toBe(false);
  });
});

describe("isStoryLive — the 24h boundary, client side", () => {
  const now = Date.parse("2026-09-27T12:00:00Z");
  it("is live until the instant it expires, then not", () => {
    expect(isStoryLive("2026-09-27T12:00:01Z", now)).toBe(true);
    expect(isStoryLive("2026-09-27T12:00:00Z", now)).toBe(false);
    expect(isStoryLive("2026-09-26T12:00:00Z", now)).toBe(false);
    expect(isStoryLive("garbage", now)).toBe(false);
  });
});

describe("storyDurationMs", () => {
  it("gives short text five seconds and caps long text at twelve", () => {
    expect(storyDurationMs("PR!")).toBe(5_000);
    expect(storyDurationMs("x".repeat(40))).toBe(5_000);
    expect(storyDurationMs("x".repeat(100))).toBe(5_000 + 60 * 45);
    expect(storyDurationMs("x".repeat(200))).toBe(12_000);
  });
});

describe("story sequence — tap right / tap left", () => {
  // Three authors: two stories, none (filtered out upstream, but be safe), three.
  const counts = [2, 0, 3];

  it("steps through one author's stories, then into the next author", () => {
    expect(nextStoryPos({ author: 0, story: 0 }, counts)).toEqual({ author: 0, story: 1 });
    expect(nextStoryPos({ author: 0, story: 1 }, counts)).toEqual({ author: 2, story: 0 });
    expect(nextStoryPos({ author: 2, story: 1 }, counts)).toEqual({ author: 2, story: 2 });
  });
  it("ends after the last story of the last author", () => {
    expect(nextStoryPos({ author: 2, story: 2 }, counts)).toBeNull();
  });
  it("goes back within an author, then to the previous author's start", () => {
    expect(prevStoryPos({ author: 2, story: 2 }, counts)).toEqual({ author: 2, story: 1 });
    expect(prevStoryPos({ author: 2, story: 0 }, counts)).toEqual({ author: 0, story: 0 });
  });
  it("has nowhere before the very first story", () => {
    expect(prevStoryPos({ author: 0, story: 0 }, counts)).toBeNull();
  });
  it("handles a single story", () => {
    expect(nextStoryPos({ author: 0, story: 0 }, [1])).toBeNull();
    expect(prevStoryPos({ author: 0, story: 0 }, [1])).toBeNull();
  });
});

describe("firstUnseenIndex", () => {
  it("opens an author at their first unseen story, or the first when all are seen", () => {
    expect(firstUnseenIndex([{ seen: true }, { seen: false }, { seen: false }])).toBe(1);
    expect(firstUnseenIndex([{ seen: true }, { seen: true }])).toBe(0);
    expect(firstUnseenIndex([])).toBe(0);
  });
});
