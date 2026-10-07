import { describe, expect, it } from "vitest";
import { ROBOTS_DISALLOW, robotsRules, sitemapEntries } from "./seo";

/**
 * How Google reads robots.txt: the longest matching rule wins, Allow wins a
 * tie; "*" matches anything and "$" anchors the end. Enough to prove the
 * public pages stay crawlable and the private ones do not.
 */
function allowed(path: string, allow: string[], disallow: readonly string[]): boolean {
  const match = (rule: string) => {
    const anchored = rule.endsWith("$");
    const body = (anchored ? rule.slice(0, -1) : rule).split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
    return new RegExp(`^${body}${anchored ? "$" : ""}`).test(path);
  };
  const best = (rules: readonly string[]) => Math.max(-1, ...rules.filter(match).map((r) => r.length));
  return best(allow) >= best(disallow);
}

describe("robots.txt", () => {
  const r = robotsRules("https://www.voinic.fit");
  const rule = r.rules[0]!;
  const ok = (p: string) => allowed(p, rule.allow, rule.disallow);

  it("the directory and every coach page are crawlable", () => {
    expect(ok("/")).toBe(true);
    expect(ok("/coaches")).toBe(true);
    expect(ok("/coaches?all=1")).toBe(true);
    expect(ok("/coaches/andrei-popescu")).toBe(true);
    // a coach whose slug starts like a private word is still public
    expect(ok("/coaches/coach-maria")).toBe(true);
    expect(ok("/coaches/reviews-king")).toBe(true);
  });
  it("the app and the reader-specific corners are not", () => {
    for (const p of ["/dashboard", "/admin/users", "/today", "/messages/1", "/coach", "/coach/messages/1",
                     "/coaches/requests", "/coaches/saved", "/coaches/bookings", "/coaches/andrei/book", "/coaches/andrei/review"]) {
      expect(ok(p), p).toBe(false);
    }
  });
  it("never blocks the public prefix by accident", () => {
    expect(ROBOTS_DISALLOW).not.toContain("/coach");
    expect(ROBOTS_DISALLOW).not.toContain("/coaches");
  });
  it("points at the sitemap on the real domain", () => {
    expect(r.sitemap).toBe("https://www.voinic.fit/sitemap.xml");
  });
});

describe("sitemap.xml", () => {
  it("the landing, the directory, then each indexable coach with its date", () => {
    const entries = sitemapEntries("https://www.voinic.fit", [
      { slug: "andrei-popescu", last_modified: "2026-10-05T10:00:00Z" },
      { slug: "maria", last_modified: null },
    ]);
    expect(entries.map((e) => e.url)).toEqual([
      "https://www.voinic.fit", "https://www.voinic.fit/coaches",
      "https://www.voinic.fit/coaches/andrei-popescu", "https://www.voinic.fit/coaches/maria",
    ]);
    expect(entries[2]!.lastModified?.toISOString()).toBe("2026-10-05T10:00:00.000Z");
    expect(entries[3]).not.toHaveProperty("lastModified");
  });
});
