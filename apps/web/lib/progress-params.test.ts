import { describe, expect, it } from "vitest";
import { parseProgressParams, progressHref } from "./progress-params";

const ID = "3f2b8c1e-0a4d-4e7b-9c1f-2d3e4f5a6b7c";

describe("parseProgressParams", () => {
  it("defaults to 30 days on the body tab with no exercise", () => {
    expect(parseProgressParams({})).toEqual({ range: 30, tab: "body", exercise: null });
  });

  it("reads every supported range, and 'all' as all time", () => {
    for (const r of [7, 30, 90, 365]) expect(parseProgressParams({ range: String(r) }).range).toBe(r);
    expect(parseProgressParams({ range: "all" }).range).toBeNull();
  });

  it("falls back on an unknown range or tab rather than trusting the URL", () => {
    expect(parseProgressParams({ range: "12", tab: "admin" })).toEqual({ range: 30, tab: "body", exercise: null });
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
    expect(progressHref({ range: 30, tab: "body", exercise: null })).toBe("/progress");
  });

  it("round-trips through the parser", () => {
    const state = { range: null, tab: "strength" as const, exercise: ID };
    const href = progressHref(state);
    const params = Object.fromEntries(new URL(href, "http://x").searchParams);
    expect(parseProgressParams(params)).toEqual(state);
  });
});
