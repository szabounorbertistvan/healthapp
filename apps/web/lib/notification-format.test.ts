import { describe, expect, it } from "vitest";
import { commonMessages } from "./i18n/messages/common";
import { notificationHref, notificationSentence } from "./notification-href";
import {
  READ_NONE, dayBucket, groupByDay, isRowRead, notificationHeadline, notificationKind, readReducer, unreadLeft,
  type HeadlineInput,
} from "./notification-format";

const strings = (locale: "en" | "ro") => ({
  notified: commonMessages[locale].social.notified,
  someone: commonMessages[locale].notifications.someone,
});
const row = (over: Partial<HeadlineInput>): HeadlineInput => ({
  sentence: null, title: "Engine title", body: null, actor: null, badge: null, challenge: null, ...over,
});

describe("notificationHeadline — EN and RO, from the category and the actor", () => {
  it("names the actor on social rows", () => {
    const kudos = row({ sentence: "new_kudos", actor: { name: "alex" } });
    expect(notificationHeadline(kudos, strings("en"), "en")).toBe("alex reacted to your post");
    expect(notificationHeadline(kudos, strings("ro"), "ro")).toBe("alex a reacționat la postarea ta");
    expect(notificationHeadline(row({ sentence: "new_follower", actor: { name: "alex" } }), strings("ro"), "ro"))
      .toBe("alex te urmărește acum");
    expect(notificationHeadline(row({ sentence: "comment_reply", actor: { name: "maria" } }), strings("en"), "en"))
      .toBe("maria replied to your comment");
  });
  it("tells a caption mention from a comment mention", () => {
    const post = row({ sentence: "new_mention_post", actor: { name: "maria" } });
    const comment = row({ sentence: "new_mention", actor: { name: "maria" } });
    expect(notificationHeadline(post, strings("en"), "en")).toBe("maria mentioned you in a post");
    expect(notificationHeadline(comment, strings("ro"), "ro")).toBe("maria te-a menționat într-un comentariu");
  });
  it("never shows a hidden actor's name: 'Someone' instead", () => {
    const hidden = row({ sentence: "new_follower", actor: null, title: "bogdan" });
    expect(notificationHeadline(hidden, strings("en"), "en")).toBe("Someone started following you");
    expect(notificationHeadline(hidden, strings("en"), "en")).not.toContain("bogdan");
  });
  it("reads a badge in the reader's language", () => {
    const badge = row({ sentence: "badge_earned", badge: { en: "First workout", ro: "Primul antrenament" } });
    expect(notificationHeadline(badge, strings("en"), "en")).toBe("You unlocked First workout");
    expect(notificationHeadline(badge, strings("ro"), "ro")).toBe("Ai deblocat Primul antrenament");
  });
  it("keeps the engine's own title for reminders", () => {
    expect(notificationHeadline(row({ title: "Check-in due" }), strings("en"), "en")).toBe("Check-in due");
  });
});

describe("type mapping: category → sentence → icon and link", () => {
  const P = "0f000000-0000-0000-0000-000000000001";
  const C = "0c000000-0000-0000-0000-000000000001";
  it("maps each social category to its kind", () => {
    expect(notificationKind(notificationSentence("new_follower", {}))).toBe("follow");
    expect(notificationKind(notificationSentence("new_kudos", {}))).toBe("kudos");
    expect(notificationKind(notificationSentence("comment_reply", {}))).toBe("comment");
    expect(notificationKind(notificationSentence("new_mention", { comment_id: C }))).toBe("mention");
    expect(notificationKind(notificationSentence("new_mention", {}))).toBe("mention");
    expect(notificationKind(notificationSentence("badge_earned", {}))).toBe("badge");
    expect(notificationKind(notificationSentence("streak_risk", {}))).toBe("system");
  });
  it("links a comment or reply to that comment, and a badge to its page", () => {
    expect(notificationHref("new_comment", { post_id: P, comment_id: C })).toBe(`/feed/${P}#comment-${C}`);
    expect(notificationHref("badge_earned", { badge_slug: "first-workout" })).toBe("/achievements/first-workout");
  });
});

describe("dayBucket / groupByDay — the reader's calendar, not 24 hours", () => {
  const TZ = "Europe/Bucharest"; // UTC+3 in late September
  const NOW = "2026-09-27T21:10:00Z"; // 00:10 on 28 Sep in Bucharest

  it("puts 23:50 local on the previous day in Yesterday, not Today", () => {
    expect(dayBucket("2026-09-27T20:50:00Z", NOW, TZ)).toBe("yesterday"); // 23:50 on 27 Sep local
    expect(dayBucket("2026-09-27T21:05:00Z", NOW, TZ)).toBe("today"); // 00:05 on 28 Sep local
  });
  it("calls anything before yesterday Earlier", () => {
    expect(dayBucket("2026-09-25T12:00:00Z", NOW, TZ)).toBe("earlier");
  });
  it("gives the same answer in UTC for a UTC reader", () => {
    expect(dayBucket("2026-09-27T20:50:00Z", NOW, "UTC")).toBe("today");
  });
  it("survives an unknown time zone and a broken timestamp", () => {
    expect(dayBucket("2026-09-27T21:05:00Z", NOW, "Not/AZone")).toBe("today");
    expect(dayBucket("garbage", NOW, TZ)).toBe("earlier");
  });
  it("groups in order, keeps row order, drops empty groups", () => {
    const rows = [
      { id: "a", created_at: "2026-09-27T21:05:00Z" },
      { id: "b", created_at: "2026-09-25T12:00:00Z" },
      { id: "c", created_at: "2026-09-24T12:00:00Z" },
    ];
    expect(groupByDay(rows, NOW, TZ)).toEqual([
      { bucket: "today", rows: [rows[0]] },
      { bucket: "earlier", rows: [rows[1], rows[2]] },
    ]);
  });
});

describe("readReducer — mark one, mark all, and what counts as unread", () => {
  const rows = [
    { id: "a", read: false },
    { id: "b", read: false },
    { id: "c", read: true },
  ];

  it("marks one read and takes it off the count", () => {
    const s = readReducer(READ_NONE, { type: "mark", id: "a" });
    expect(isRowRead(s, rows[0]!)).toBe(true);
    expect(isRowRead(s, rows[1]!)).toBe(false);
    expect(unreadLeft(s, 2, rows)).toBe(1);
  });
  it("marking an already-read row does not take one more off", () => {
    const s = readReducer(READ_NONE, { type: "mark", id: "c" });
    expect(unreadLeft(s, 2, rows)).toBe(2);
    expect(readReducer(s, { type: "mark", id: "c" })).toBe(s);
  });
  it("mark all: every row read, count zero", () => {
    const s = readReducer(READ_NONE, { type: "markAll" });
    expect(rows.every((r) => isRowRead(s, r))).toBe(true);
    expect(unreadLeft(s, 7, rows)).toBe(0);
  });
  it("a refresh resets to the server's truth", () => {
    const s = readReducer(readReducer(READ_NONE, { type: "markAll" }), { type: "reset" });
    expect(s).toEqual(READ_NONE);
  });
  it("never counts below zero", () => {
    const s = readReducer(readReducer(READ_NONE, { type: "mark", id: "a" }), { type: "mark", id: "b" });
    expect(unreadLeft(s, 1, rows)).toBe(0);
  });
});
