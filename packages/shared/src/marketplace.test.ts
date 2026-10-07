import { describe, expect, it } from "vitest";
import {
  bayesianRating, classifyAttribution, cleanToken, coldStartBoost, rankQuality, rankScore, signupReference,
} from "./marketplace";
import { COACH_REPORT_REASONS, reportReasonsFor, validateReport } from "./moderation";

describe("classifyAttribution", () => {
  const site = "www.voinic.fit";
  it("utm_source wins, cleaned and with aliases folded", () => {
    expect(classifyAttribution({ utmSource: " Instagram ", utmMedium: "Social", utmCampaign: "Spring 26!" }))
      .toEqual({ source: "instagram", medium: "social", campaign: "spring26" });
    expect(classifyAttribution({ utmSource: "ig" }).source).toBe("instagram");
    expect(classifyAttribution({ utmSource: "tiktok", referrer: "https://www.google.com/" }).source).toBe("tiktok");
  });
  it("otherwise the referrer: known hosts by name, the site itself as internal, the rest as referral", () => {
    expect(classifyAttribution({ referrer: "https://www.google.ro/search?q=antrenor", siteHost: site }).source).toBe("google");
    expect(classifyAttribution({ referrer: "https://l.instagram.com/?u=x", siteHost: site }).source).toBe("instagram");
    expect(classifyAttribution({ referrer: "https://www.tiktok.com/@coach", siteHost: site }).source).toBe("tiktok");
    expect(classifyAttribution({ referrer: "https://m.facebook.com/", siteHost: site }).source).toBe("facebook");
    expect(classifyAttribution({ referrer: "https://voinic.fit/coaches", siteHost: site }).source).toBe("internal");
    expect(classifyAttribution({ referrer: "https://someblog.example/post", siteHost: site }).source).toBe("referral");
  });
  it("no referrer is direct (null); garbage is not a source", () => {
    expect(classifyAttribution({ siteHost: site })).toEqual({ source: null, medium: null, campaign: null });
    expect(classifyAttribution({ referrer: "not a url", siteHost: site }).source).toBeNull();
    expect(classifyAttribution({ utmSource: "!!!" }).source).toBeNull();
  });
  it("cleanToken keeps only the stored alphabet", () => {
    expect(cleanToken("<script>alert(1)</script>", 40)).toBe("scriptalert1script");
    expect(cleanToken("x".repeat(100), 40)).toHaveLength(40);
    expect(cleanToken(42, 40)).toBeNull();
  });
});

describe("signupReference", () => {
  it("names the coach page from the next path, never from a free field", () => {
    expect(signupReference("/coaches/andrei-popescu", { source: "Instagram" }))
      .toEqual({ coach: "andrei-popescu", source: "instagram", medium: null, campaign: null });
    expect(signupReference("/coaches/andrei-popescu?intent=save", {})?.coach).toBe("andrei-popescu");
    expect(signupReference("/coaches/saved", { source: "google" })?.coach).toBeNull();
    expect(signupReference("/today", {})).toBeNull();
    expect(signupReference("https://evil.example/coaches/x", {})).toBeNull();
  });
});

describe("ranking mirror", () => {
  it("5.0 from one review is worth less than 4.9 from 150", () => {
    expect(bayesianRating(1, 5)).toBeCloseTo(3.75, 2);
    expect(bayesianRating(150, 4.9)).toBeCloseTo(4.855, 2);
    expect(rankQuality(150, 4.9, 0, 0)).toBeGreaterThan(rankQuality(1, 5, 0, 0));
  });
  it("no reviews is neutral, not zero — and many poor ones rank below it", () => {
    expect(rankQuality(0, null, 0, 0)).toBeCloseTo(0.4375, 4); // pgTAP pins 0.438
    expect(rankQuality(20, 2, 0, 0)).toBeLessThan(rankQuality(0, null, 0, 0));
  });
  it("the cold-start boost is small, fades, and needs a qualified profile", () => {
    expect(coldStartBoost(0, true)).toBeCloseTo(0.06);
    expect(coldStartBoost(22.5, true)).toBeCloseTo(0.03);
    expect(coldStartBoost(45, true)).toBe(0);
    expect(coldStartBoost(2, false)).toBe(0);
  });
  it("verification cannot beat clearly better relevance", () => {
    const base = { trust: 0.3, quality: 0.4375, responsiveness: 0.7, activity: 0.2, engagement: 0, cold_start: 0, placement: 0 };
    const specialist = rankScore({ ...base, relevance: 1 });
    const verifiedMention = rankScore({ ...base, trust: base.trust + 0.55, relevance: 0.5 });
    expect(specialist).toBeGreaterThan(verifiedMention);
    // but between equally relevant coaches, it decides
    expect(rankScore({ ...base, trust: base.trust + 0.55, relevance: 1 })).toBeGreaterThan(specialist);
  });
});

describe("report reasons per target", () => {
  it("fake credentials is a coach-profile reason only", () => {
    expect(COACH_REPORT_REASONS).toContain("fake_credentials");
    expect(reportReasonsFor("post")).not.toContain("fake_credentials");
    expect(validateReport({ reason: "fake_credentials", target: "coach" }).ok).toBe(true);
    expect(validateReport({ reason: "fake_credentials", target: "user" })).toEqual({ ok: false, error: "reason" });
    expect(validateReport({ reason: "hate", target: "coach" })).toEqual({ ok: false, error: "reason" });
  });
});
