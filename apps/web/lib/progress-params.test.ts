import { describe, expect, it } from "vitest";
import { parseProgressParams, progressHref } from "./progress-params";

const ID = "3f2b8c1e-0a4d-4e7b-9c1f-2d3e4f5a6b7c";

describe("parseProgressParams", () => {
  it("defaults to 30 days on the body tab with no exercise", () => {
    expect(parseProgressParams({})).toEqual({ range: 30, tab: "body", exercise: null, from: null, to: null });
  });

  it("reads every supported range, and 'all' as all time", () => {
    for (const r of [7, 30, 90, 365]) expect(parseProgressParams({ range: String(r) }).range).toBe(r);
    expect(parseProgressParams({ range: "all" }).range).toBeNull();
  });

  it("falls back on an unknown range or tab rather than trusting the URL", () => {
    expect(parseProgressParams({ range: "12", tab: "admin" })).toEqual({ range: 30, tab: "body", exercise: null, from: null, to: null });
  });

  it("knows the goals tab and links to it", () => {
    expect(parseProgressParams({ tab: "goals" }).tab).toBe("goals");
    expect(progressHref({ range: 30, tab: "goals", exercise: null, from: null, to: null })).toBe("/progress?tab=goals");
  });

  it("accepts only a uuid as the exercise", () => {
    expect(parseProgressParams({ exercise: ID }).exercise).toBe(ID);
    expect(parseProgressParams({ exercise: "x' or 1=1" }).exercise).toBeNull();
  });

  it("takes the first value of a repeated parameter", () => {
    expect(parseProgressParams({ range: ["7", "90"], tab: ["strength"] })).toMatchObject({ range: 7, tab: "strength" });
  });
});

describe("progressHref", () => {
  it("omits defaults", () => {
    expect(progressHref({ range: 30, tab: "body", exercise: null, from: null, to: null })).toBe("/progress");
  });

  it("round-trips through the parser", () => {
    const state = { range: null, tab: "strength" as const, exercise: ID, from: null, to: null };
    const href = progressHref(state);
    const params = Object.fromEntries(new URL(href, "http://x").searchParams);
    expect(parseProgressParams(params)).toEqual(state);
  });
});

describe("the two comparison dates", () => {
  it("accepts real calendar days only", () => {
    expect(parseProgressParams({ from: "2026-09-01", to: "2026-10-01" })).toMatchObject({ from: "2026-09-01", to: "2026-10-01" });
    expect(parseProgressParams({ from: "2026-02-30" }).from).toBeNull();
    expect(parseProgressParams({ from: "1 or 1=1", to: "2026-9-1" })).toMatchObject({ from: null, to: null });
  });

  it("round-trips through the URL", () => {
    const state = { range: 90 as const, tab: "body" as const, exercise: null, from: "2026-08-01", to: "2026-10-01" };
    const params = Object.fromEntries(new URL(progressHref(state), "http://x").searchParams);
    expect(parseProgressParams(params)).toEqual(state);
  });
});
