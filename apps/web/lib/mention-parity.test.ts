import { describe, expect, it } from "vitest";
import { extractMentionHandles } from "@healthapp/shared";

// The database checks every mention row against the handles in the text
// (social_mention_handles, 20261012100000), with a regex copied from
// extractMentionHandles(). These are the same four strings the pgTAP suite
// (supabase/tests/social_data_integrity.test.sql, "parser parity") runs
// through the SQL side: if either parser changes alone, one of the two fails.
describe("extractMentionHandles — the parser the database mirrors", () => {
  it("finds handles in order, lower-cased", () => {
    expect(extractMentionHandles("well done @fandi and @Strangerdi, cc @nobodydi")).toEqual(["fandi", "strangerdi", "nobodydi"]);
  });
  it("does not read an e-mail address or a too-short handle as a mention", () => {
    expect(extractMentionHandles("write me@host.com or @ab")).toEqual([]);
  });
  it("names one person once, whatever the case", () => {
    expect(extractMentionHandles("@a1b2 @A1B2 @c3d4")).toEqual(["a1b2", "c3d4"]);
  });
  it("takes ten at most", () => {
    expect(extractMentionHandles("@u001 @u002 @u003 @u004 @u005 @u006 @u007 @u008 @u009 @u010 @u011")).toHaveLength(10);
  });
});
