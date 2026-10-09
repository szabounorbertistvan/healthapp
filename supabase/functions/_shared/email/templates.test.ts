import { describe, expect, it } from "vitest";
import { MARKETPLACE_EMAIL_RULES } from "../../../../packages/shared/src/marketplace-email.ts";
import { emailLocale, renderMarketplaceEmail, templateKeys } from "./templates.ts";

const base = { link: "https://www.voinic.fit/bookings", settingsLink: "https://www.voinic.fit/account" };

describe("marketplace templates", () => {
  it("exist for every eligible event, in Romanian and in English", () => {
    const rules = MARKETPLACE_EMAIL_RULES.map((r) => `${r.category}/${r.event}`).sort();
    expect(templateKeys("ro")).toEqual(rules);
    expect(templateKeys("en")).toEqual(rules);
  });

  it("follow the recipient's locale, Romanian when unknown", () => {
    expect(emailLocale("en")).toBe("en");
    expect(emailLocale(null)).toBe("ro");
    const ro = renderMarketplaceEmail({ ...base, category: "booking", event: "confirmed", locale: "ro", actorName: "Kai" })!;
    const en = renderMarketplaceEmail({ ...base, category: "booking", event: "confirmed", locale: "en", actorName: "Kai" })!;
    expect(ro.subject).toMatch(/^Programare confirmată/);
    expect(en.subject).toMatch(/^Booking confirmed/);
    expect(ro.html).toContain('lang="ro"');
    expect(ro.html).toContain("Voinic");
    expect(ro.html).toContain(base.link);
    expect(ro.text).toContain(base.link);
  });

  it("show a session time in the recipient's time zone", () => {
    const e = renderMarketplaceEmail({
      ...base, category: "booking", event: "reminder", locale: "en", actorName: "Kai",
      startsAt: "2026-10-12T07:00:00Z", timeZone: "Europe/Bucharest",
    })!;
    expect(e.text).toContain("10:00");
  });

  it("escape a hostile display name and keep it out of the subject's line structure", () => {
    const e = renderMarketplaceEmail({
      ...base, category: "coaching_request", event: "sent", locale: "en", actorName: '<img src=x onerror=alert(1)>\r\nBcc: evil@x.test',
    })!;
    expect(e.html).not.toContain("<img");
    expect(e.html).toContain("&lt;img");
    expect(e.subject).not.toMatch(/[\r\n]/);
  });

  it("announce a new message without its text or its sender", () => {
    const e = renderMarketplaceEmail({ ...base, category: "new_message", event: "*", locale: "ro", actorName: "Kai Secretname" })!;
    for (const part of [e.subject, e.html, e.text]) {
      expect(part).not.toContain("Secretname");
    }
    expect(e.subject).toBe("Ai un mesaj nou în Voinic");
  });

  it("render nothing for an event without copy", () => {
    expect(renderMarketplaceEmail({ ...base, category: "coaching", event: "paused", locale: "ro", actorName: "Kai" })).toBeNull();
  });
});
