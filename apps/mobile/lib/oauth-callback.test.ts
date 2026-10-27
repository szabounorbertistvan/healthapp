import { describe, expect, it } from "vitest";
import { enabledProviders, parseOAuthCallback } from "./oauth-callback";

describe("parseOAuthCallback", () => {
  it("reads the PKCE code from the query", () => {
    expect(parseOAuthCallback("voinic://auth/callback?code=abc-123")).toEqual({ kind: "code", code: "abc-123" });
  });

  it("works with Expo Go's exp:// address too", () => {
    expect(parseOAuthCallback("exp://192.168.1.5:8081/--/auth/callback?code=xyz")).toEqual({ kind: "code", code: "xyz" });
  });

  it("prefers the error description when the provider refused", () => {
    expect(parseOAuthCallback("voinic://auth/callback?error=access_denied&error_description=User%20cancelled")).toEqual({ kind: "error", error: "User cancelled" });
  });

  it("finds an error that arrives in the fragment", () => {
    expect(parseOAuthCallback("voinic://auth/callback#error=server_error")).toEqual({ kind: "error", error: "server_error" });
  });

  it("an address with neither is an error, never a silent success", () => {
    expect(parseOAuthCallback("voinic://auth/callback").kind).toBe("error");
  });
});

describe("enabledProviders", () => {
  it("keeps only the providers switched on", () => {
    expect(enabledProviders({ external: { google: true, apple: false, email: true } })).toEqual(new Set(["google", "email"]));
  });

  it("an unreadable answer means none", () => {
    expect(enabledProviders(null).size).toBe(0);
    expect(enabledProviders({}).size).toBe(0);
  });
});
