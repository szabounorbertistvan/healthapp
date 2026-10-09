import { describe, expect, it } from "vitest";
import { callbackDestination, SIGNUP_NEXT_KEY } from "./auth-redirect";

const BACKSLASH = String.fromCharCode(92);
const saved = (next: unknown) => ({ [SIGNUP_NEXT_KEY]: next });

describe("callbackDestination", () => {
  it("keeps the next the sign-up saved, query string included, when the link carries none", () => {
    expect(callbackDestination({ next: null, type: "signup", metadata: saved("/coaches/ana/book?service=s1&at=2026-10-12T09:00") }))
      .toBe("/coaches/ana/book?service=s1&at=2026-10-12T09:00");
    expect(callbackDestination({ next: null, type: "email", metadata: saved("/coaches/ana") })).toBe("/coaches/ana");
  });

  it("prefers an explicit ?next= (recovery links, PKCE ?code= links) over the saved one", () => {
    expect(callbackDestination({ next: "/reset-password", type: "recovery", metadata: saved("/coaches/ana") }))
      .toBe("/reset-password");
    expect(callbackDestination({ next: "/coaches/bob?intent=follow", type: "signup", metadata: saved("/coaches/ana") }))
      .toBe("/coaches/bob?intent=follow");
  });

  it("reads the saved next on confirmation links only", () => {
    for (const type of ["recovery", "invite", "email_change", null]) {
      expect(callbackDestination({ next: null, type, metadata: saved("/coaches/ana") })).toBe("/dashboard");
    }
  });

  it("falls back to /dashboard with nothing usable", () => {
    expect(callbackDestination({ next: null, type: "signup", metadata: null })).toBe("/dashboard");
    expect(callbackDestination({ next: "", type: "signup", metadata: {} })).toBe("/dashboard");
    expect(callbackDestination({ next: undefined, type: "signup", metadata: saved(42) })).toBe("/dashboard");
  });

  it("never leaves the site, whichever source the destination came from", () => {
    const hostile = [
      "https://evil.com", "//evil.com", `/${BACKSLASH}evil.com`, "/\t/evil.com", "javascript:alert(1)",
      "evil.com", "/%5Cevil.com/..", "  /dashboard",
    ];
    for (const bad of hostile) {
      for (const out of [
        callbackDestination({ next: bad, type: "signup", metadata: null }),
        callbackDestination({ next: null, type: "signup", metadata: saved(bad) }),
      ]) {
        expect(new URL(out, "https://www.voinic.fit").origin).toBe("https://www.voinic.fit");
        expect(out.startsWith("/")).toBe(true);
      }
    }
    expect(callbackDestination({ next: null, type: "signup", metadata: saved("javascript:alert(1)") })).toBe("/dashboard");
  });
});
