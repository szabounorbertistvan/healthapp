import { describe, expect, it } from "vitest";
import {
  CLIENT_GOALS, MAX_CLIENT_GOALS, cleanClientGoals, cleanSocialLinks, hasRiskyClaim, socialEntries, socialUrl, validSocialValue,
} from "./coach-content";

describe("social links: handles, never URLs", () => {
  it("accepts handles and an https website", () => {
    expect(cleanSocialLinks({ instagram: "ana.fit", tiktok: "ana_fit", website: "https://ana.ro/coaching" }))
      .toEqual({ links: { instagram: "ana.fit", tiktok: "ana_fit", website: "https://ana.ro/coaching" }, invalid: null });
  });
  it("reduces a pasted profile address or a leading @ to the handle", () => {
    expect(cleanSocialLinks({ instagram: "https://www.instagram.com/ana.fit/?hl=ro", tiktok: "@ana_fit", linkedin: "https://linkedin.com/in/ana-pop" }).links)
      .toEqual({ instagram: "ana.fit", tiktok: "ana_fit", linkedin: "ana-pop" });
    expect(cleanSocialLinks({ youtube: "https://youtube.com/@AnaFit" }).links).toEqual({ youtube: "@AnaFit" });
  });
  it("refuses what the database would refuse, and names it", () => {
    expect(cleanSocialLinks({ website: "javascript:alert(1)" })).toEqual({ links: {}, invalid: "website" });
    expect(cleanSocialLinks({ website: "http://ana.ro" }).invalid).toBe("website");
    expect(cleanSocialLinks({ instagram: "ana fit" }).invalid).toBe("instagram");
    expect(cleanSocialLinks({ facebook: "abc" }).invalid).toBe("facebook");
  });
  it("drops empty entries", () => {
    expect(cleanSocialLinks({ instagram: "  ", website: "" })).toEqual({ links: {}, invalid: null });
  });
  it("builds every link itself", () => {
    expect(socialUrl("instagram", "ana.fit")).toBe("https://www.instagram.com/ana.fit/");
    expect(socialUrl("tiktok", "ana_fit")).toBe("https://www.tiktok.com/@ana_fit");
    expect(socialUrl("youtube", "AnaFit")).toBe("https://www.youtube.com/@AnaFit");
    expect(socialUrl("linkedin", "ana-pop")).toBe("https://www.linkedin.com/in/ana-pop");
    expect(socialUrl("website", "https://ana.ro")).toBe("https://ana.ro");
    expect(socialUrl("instagram", "../evil")).toBeNull();
  });
  it("lists stored links in a fixed order, skipping anything invalid", () => {
    expect(socialEntries({ website: "https://ana.ro/", instagram: "ana.fit", tiktok: "bad handle!" }))
      .toEqual([
        { network: "instagram", url: "https://www.instagram.com/ana.fit/", label: "ana.fit" },
        { network: "website", url: "https://ana.ro/", label: "ana.ro" },
      ]);
    expect(socialEntries(null)).toEqual([]);
  });
  it("mirrors the SQL patterns", () => {
    expect(validSocialValue("instagram", "a".repeat(30))).toBe(true);
    expect(validSocialValue("instagram", "a".repeat(31))).toBe(false);
    expect(validSocialValue("website", `https://a.ro/${"x".repeat(200)}`)).toBe(false);
  });
});

describe("client goals", () => {
  it("keeps known codes, in catalog order, once, capped", () => {
    expect(cleanClientGoals(["strength", "nope", "fat_loss", "strength"])).toEqual(["fat_loss", "strength"]);
    expect(cleanClientGoals([...CLIENT_GOALS])).toHaveLength(MAX_CLIENT_GOALS);
  });
});

describe("risky claims", () => {
  it("flags guarantees, fixed weight-loss promises and medical claims", () => {
    expect(hasRiskyClaim("Guaranteed results or your money back")).toBe(true);
    expect(hasRiskyClaim("Rezultate garantate în 30 de zile")).toBe(true);
    expect(hasRiskyClaim("Lose 10 kg in 4 weeks")).toBe(true);
    expect(hasRiskyClaim("Slăbești 8 kg în 30 de zile")).toBe(true);
    expect(hasRiskyClaim("I can cure your back pain")).toBe(true);
    expect(hasRiskyClaim("Vindecăm diabetul prin sport")).toBe(true);
    expect(hasRiskyClaim("100% results")).toBe(true);
  });
  it("leaves an honest description alone", () => {
    expect(hasRiskyClaim("I help beginners build strength with weekly check-ins.")).toBe(false);
    expect(hasRiskyClaim("Clients usually train 3 times a week for 12 weeks.")).toBe(false);
    expect(hasRiskyClaim("Am pierdut 20 kg acum 5 ani și de atunci antrenez.")).toBe(false);
    expect(hasRiskyClaim("")).toBe(false);
  });
});
