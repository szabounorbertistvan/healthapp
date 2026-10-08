import { describe, expect, it } from "vitest";
import { ROBOTS_DISALLOW, landingCopy, landingJsonLd, landingMetadata, robotsRules, sitemapEntries } from "./seo";

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

describe("landing listings (20261111110000)", () => {
  const copy = {
    cityTitle: "Personal trainers in {place}", cityIntro: "Coaches in {place}.", specializationTitle: "{name} coaches",
    specializationIntro: "Focus: {name}.", countryTitle: "Coaches in {place}", countryIntro: "In {place}.",
    metaCity: "{n} coaches in {place}.", metaSpecialization: "{n} {name} coaches.", metaCountry: "{n} coaches in {place}.",
  };
  it("the sitemap lists landing pages once, never a filtered URL", () => {
    const urls = sitemapEntries("https://www.voinic.fit", [], ["cluj-napoca", "weight-loss", "cluj-napoca"]).map((e) => e.url);
    expect(urls).toEqual(["https://www.voinic.fit", "https://www.voinic.fit/coaches",
      "https://www.voinic.fit/coaches/cluj-napoca", "https://www.voinic.fit/coaches/weight-loss"]);
    expect(urls.some((u) => u.includes("?"))).toBe(false);
  });
  it("a landing page has its own canonical, and is indexable only with enough coaches", () => {
    const m = landingMetadata({ kind: "city", slug: "cluj-napoca", name: "Cluj-Napoca", coaches: 4 },
      { siteUrl: "https://www.voinic.fit", appName: "Voinic", locale: "en", copy });
    expect(m.title).toBe("Personal trainers in Cluj-Napoca | Voinic");
    expect(m.description).toBe("4 coaches in Cluj-Napoca.");
    expect(m.alternates.canonical).toBe("https://www.voinic.fit/coaches/cluj-napoca");
    expect(m.robots).toEqual({ index: true, follow: true });
    for (const coaches of [0, 2]) {
      expect(landingMetadata({ kind: "specialization", slug: "kettlebell", name: "Kettlebell", coaches },
        { siteUrl: "https://s", appName: "Voinic", locale: "en", copy }).robots).toEqual({ index: false, follow: true });
    }
  });
  it("copy per kind", () => {
    expect(landingCopy({ kind: "specialization", name: "Weight Loss" }, copy)).toEqual({ title: "Weight Loss coaches", intro: "Focus: Weight Loss." });
    expect(landingCopy({ kind: "country", name: "Romania" }, copy).title).toBe("Coaches in Romania");
  });
  it("structured data: a CollectionPage of the coaches shown, and a breadcrumb", () => {
    const ld = landingJsonLd({ slug: "cluj-napoca", title: "Trainers in Cluj" }, [{ slug: "ana", name: "Ana" }], "https://s",
      { home: "Voinic", coaches: "Coaches" });
    const [page, crumbs] = ld["@graph"];
    expect(page).toMatchObject({ "@type": "CollectionPage", url: "https://s/coaches/cluj-napoca" });
    expect((page as { mainEntity: { itemListElement: unknown[] } }).mainEntity.itemListElement)
      .toEqual([{ "@type": "ListItem", position: 1, url: "https://s/coaches/ana", name: "Ana" }]);
    expect((crumbs as { itemListElement: unknown[] }).itemListElement).toHaveLength(3);
  });
});
