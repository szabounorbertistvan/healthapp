import { describe, expect, it } from "vitest";
import { isAnalyticsPath, parseConsent } from "./analytics";

describe("isAnalyticsPath", () => {
  it("measures only the public, signed-out pages", () => {
    for (const p of ["/", "/coaches", "/coaches/", "/coaches/ana-pop", "/coaches/cluj-napoca", "/coaches/ana-pop/book",
      "/coaches/city/cluj-napoca", "/coaches/specialization/strength", "/login", "/privacy", "/terms", "/get-the-app"]) {
      expect(isAnalyticsPath(p), p).toBe(true);
    }
  });

  it("never measures anything inside an account", () => {
    for (const p of ["/today", "/workout/abc/log", "/food", "/progress", "/check-in", "/coach/messages/x", "/account",
      "/dashboard", "/clients/123", "/messages/x", "/settings/coach-profile", "/admin", "/reset-password",
      "/complete-profile", "/coaches/bookings", "/coaches/requests", "/coaches/saved", "/coaches/ana-pop/review",
      "/notifications", null, undefined, ""]) {
      expect(isAnalyticsPath(p), String(p)).toBe(false);
    }
  });
});

describe("parseConsent", () => {
  it("accepts only an explicit choice", () => {
    expect(parseConsent("granted")).toBe("granted");
    expect(parseConsent("denied")).toBe("denied");
    expect(parseConsent("yes")).toBeNull();
    expect(parseConsent(null)).toBeNull();
  });
});
