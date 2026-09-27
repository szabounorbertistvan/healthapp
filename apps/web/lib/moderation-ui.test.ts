import { describe, expect, it } from "vitest";
import { commonMessages } from "./i18n/messages/common";
import { REPORT_REASONS } from "@healthapp/shared";
import { postMenuActions, profileMenuActions, sheetReducer, type SheetStep } from "./moderation-ui";

describe("postMenuActions", () => {
  it("your own post: edit and delete, nothing else", () => {
    expect(postMenuActions({ mine: true, muted: false, blocked: false })).toEqual(["edit", "delete"]);
  });
  it("someone else's: mute, block, report", () => {
    expect(postMenuActions({ mine: false, muted: false, blocked: false })).toEqual(["mute", "block", "report"]);
  });
  it("already muted: unmute instead of mute, never both", () => {
    const a = postMenuActions({ mine: false, muted: true, blocked: false });
    expect(a).toContain("unmute");
    expect(a).not.toContain("mute");
  });
  it("blocked: unblock instead of block, and no mute switch", () => {
    const a = postMenuActions({ mine: false, muted: true, blocked: true });
    expect(a).toEqual(["unblock", "report"]);
  });
});

describe("profileMenuActions", () => {
  it("offers nothing on your own profile", () => {
    expect(profileMenuActions({ me: true, muted: false, blocked: false })).toEqual([]);
  });
  it("mirrors the post menu for anyone else", () => {
    expect(profileMenuActions({ me: false, muted: false, blocked: false })).toEqual(["mute", "block", "report"]);
    expect(profileMenuActions({ me: false, muted: true, blocked: false })).toEqual(["unmute", "block", "report"]);
    expect(profileMenuActions({ me: false, muted: false, blocked: true })).toEqual(["unblock", "report"]);
  });
});

describe("sheetReducer — the confirm flows", () => {
  const menu: SheetStep = { step: "menu" };

  it("mute is one tap: straight to the request, then done", () => {
    const pending = sheetReducer(menu, { type: "choose", action: "mute" });
    expect(pending).toEqual({ step: "pending", from: "menu" });
    expect(sheetReducer(pending, { type: "result", ok: true, what: "muted" })).toEqual({ step: "done", what: "muted" });
  });

  it("block asks first; only the confirmation sends it", () => {
    const confirm = sheetReducer(menu, { type: "choose", action: "block" });
    expect(confirm).toEqual({ step: "confirm-block" });
    expect(sheetReducer(confirm, { type: "back" })).toEqual(menu);
    expect(sheetReducer(confirm, { type: "confirm" })).toEqual({ step: "pending", from: "confirm-block" });
  });

  it("a report needs a reason before it can be sent", () => {
    let s = sheetReducer(menu, { type: "choose", action: "report" });
    expect(sheetReducer(s, { type: "submit" })).toBe(s);
    s = sheetReducer(s, { type: "reason", reason: "other" });
    s = sheetReducer(s, { type: "details", details: "ads" });
    expect(s).toEqual({ step: "report", reason: "other", details: "ads" });
    expect(sheetReducer(s, { type: "submit" })).toEqual({ step: "pending", from: "report" });
  });

  it("one request at a time: everything but the result is ignored while pending", () => {
    const pending: SheetStep = { step: "pending", from: "confirm-block" };
    expect(sheetReducer(pending, { type: "confirm" })).toBe(pending);
    expect(sheetReducer(pending, { type: "choose", action: "mute" })).toBe(pending);
    expect(sheetReducer(pending, { type: "back" })).toBe(pending);
  });

  it("a failure is not assumed to have happened: error, then back to where it came from", () => {
    const failed = sheetReducer({ step: "pending", from: "confirm-block" }, { type: "result", ok: false, what: "blocked" });
    expect(failed).toEqual({ step: "error", back: "confirm-block" });
    expect(sheetReducer(failed, { type: "back" })).toEqual({ step: "confirm-block" });
  });
});

const { en, ro } = commonMessages;

describe("labels, EN and RO", () => {
  it("every report reason has a label in both languages", () => {
    for (const r of REPORT_REASONS) {
      expect(en.moderation.reasons[r].length).toBeGreaterThan(0);
      expect(ro.moderation.reasons[r].length).toBeGreaterThan(0);
    }
  });
  it("the block confirmation names the person in both languages", () => {
    expect(en.moderation.blockTitle).toContain("{name}");
    expect(ro.moderation.blockTitle).toContain("{name}");
  });
});
