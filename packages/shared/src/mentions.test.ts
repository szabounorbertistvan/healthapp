import { describe, expect, it } from "vitest";
import {
  applyMention,
  commentSegments,
  extractMentionHandles,
  mentionQueryAt,
  MENTIONS_MAX,
  resolveMentions,
  type MentionRef,
} from "./mentions";

const MARIA: MentionRef = { user_id: "u-maria", username: "maria" };
const NORB: MentionRef = { user_id: "u-norb", username: "norbert" };

describe("extractMentionHandles", () => {
  it("finds a handle", () => {
    expect(extractMentionHandles("nice one @maria")).toEqual(["maria"]);
  });

  it("finds several, in the order written, without repeats", () => {
    expect(extractMentionHandles("@maria and @norbert and @maria again")).toEqual(["maria", "norbert"]);
  });

  it("lower-cases, because usernames are unique case-insensitively", () => {
    expect(extractMentionHandles("@Maria")).toEqual(["maria"]);
  });

  it("ignores an @ in the middle of a word — an email is not a mention", () => {
    expect(extractMentionHandles("write to maria@example.com")).toEqual([]);
    expect(extractMentionHandles("a@b")).toEqual([]);
  });

  it("ignores handles that could not exist under the username rule", () => {
    expect(extractMentionHandles("@a")).toEqual([]);
    expect(extractMentionHandles("@_leading")).toEqual([]);
    expect(extractMentionHandles("@")).toEqual([]);
  });

  it("stops at the cap rather than letting one comment ping a crowd", () => {
    const many = Array.from({ length: 30 }, (_, i) => `@user${i}`).join(" ");
    expect(extractMentionHandles(many)).toHaveLength(MENTIONS_MAX);
  });

  it("reads punctuation as a boundary", () => {
    expect(extractMentionHandles("(@maria) — @norbert!")).toEqual(["maria", "norbert"]);
  });

  it("is not confused by being called twice", () => {
    expect(extractMentionHandles("@maria")).toEqual(["maria"]);
    expect(extractMentionHandles("@maria")).toEqual(["maria"]);
  });
});

describe("commentSegments", () => {
  it("splits text around a known mention", () => {
    expect(commentSegments("nice one @maria !", [MARIA])).toEqual([
      { kind: "text", text: "nice one " },
      { kind: "mention", text: "@maria", user_id: "u-maria", username: "maria" },
      { kind: "text", text: " !" },
    ]);
  });

  it("leaves an unbacked handle as plain text — the rows decide, not the body", () => {
    expect(commentSegments("hello @stranger", [MARIA])).toEqual([
      { kind: "text", text: "hello @stranger" },
    ]);
  });

  it("never invents markup from user input", () => {
    const body = '<img src=x onerror="alert(1)"> @maria';
    const segments = commentSegments(body, [MARIA]);
    // The tag survives verbatim as TEXT; there is no string with markup in it
    // for a renderer to interpret.
    expect(segments[0]).toEqual({ kind: "text", text: '<img src=x onerror="alert(1)"> ' });
    expect(segments.every((s) => s.kind === "text" || s.kind === "mention")).toBe(true);
  });

  it("handles a mention at the very start and at the very end", () => {
    expect(commentSegments("@maria", [MARIA])).toEqual([
      { kind: "mention", text: "@maria", user_id: "u-maria", username: "maria" },
    ]);
    expect(commentSegments("hi @maria", [MARIA])).toEqual([
      { kind: "text", text: "hi " },
      { kind: "mention", text: "@maria", user_id: "u-maria", username: "maria" },
    ]);
  });

  it("handles two mentions in a row", () => {
    expect(commentSegments("@maria @norbert go", [MARIA, NORB])).toEqual([
      { kind: "mention", text: "@maria", user_id: "u-maria", username: "maria" },
      { kind: "text", text: " " },
      { kind: "mention", text: "@norbert", user_id: "u-norb", username: "norbert" },
      { kind: "text", text: " go" },
    ]);
  });

  it("matches case-insensitively but shows what was typed", () => {
    expect(commentSegments("hi @Maria", [MARIA])).toEqual([
      { kind: "text", text: "hi " },
      { kind: "mention", text: "@Maria", user_id: "u-maria", username: "maria" },
    ]);
  });

  it("returns one text piece when nothing is mentioned", () => {
    expect(commentSegments("just a comment", [])).toEqual([{ kind: "text", text: "just a comment" }]);
    expect(commentSegments("", [])).toEqual([]);
  });
});

describe("mentionQueryAt", () => {
  it("reports the fragment being typed", () => {
    expect(mentionQueryAt("hi @mar", 7)).toEqual({ query: "mar", start: 3 });
  });

  it("opens on a bare @, before anything is guessed at", () => {
    expect(mentionQueryAt("hi @", 4)).toEqual({ query: "", start: 3 });
  });

  it("is null when the caret is not in a mention", () => {
    expect(mentionQueryAt("hi there", 8)).toBeNull();
    expect(mentionQueryAt("mail me at a@b.com", 18)).toBeNull();
  });

  it("is null once the fragment stops looking like a handle", () => {
    expect(mentionQueryAt("hi @mar ia", 10)).toBeNull();
    expect(mentionQueryAt("hi @-nope", 9)).toBeNull();
  });

  it("looks only at the text before the caret", () => {
    expect(mentionQueryAt("@maria and more", 4)).toEqual({ query: "mar", start: 0 });
  });
});

describe("applyMention", () => {
  it("replaces the fragment and leaves the caret after the space", () => {
    const result = applyMention("hi @mar", 3, 7, "maria");
    expect(result.body).toBe("hi @maria ");
    expect(result.caret).toBe(10);
  });

  it("keeps whatever followed the fragment", () => {
    expect(applyMention("hi @mar, good set", 3, 7, "maria").body).toBe("hi @maria , good set");
  });

  it("works on a bare @", () => {
    expect(applyMention("hi @", 3, 4, "maria").body).toBe("hi @maria ");
  });
});

describe("resolveMentions", () => {
  it("keeps the handles that resolved", () => {
    expect(resolveMentions(["maria", "ghost"], [MARIA])).toEqual([MARIA]);
  });

  it("drops the ones that did not, rather than failing the comment", () => {
    expect(resolveMentions(["ghost"], [MARIA])).toEqual([]);
  });

  it("never returns the same person twice", () => {
    expect(resolveMentions(["maria", "MARIA"], [MARIA])).toEqual([MARIA]);
  });

  it("is empty when nothing was typed", () => {
    expect(resolveMentions([], [MARIA, NORB])).toEqual([]);
  });
});
