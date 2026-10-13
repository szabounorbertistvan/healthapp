import { describe, expect, it } from "vitest";
import { isLocalRequest, loopbackUrl, resolveLocalTarget } from "./local-target.mjs";

const DEFAULTS = { supabaseUrl: "http://127.0.0.1:54433", anonKey: "local-anon", serviceKey: "local-service", appUrl: "http://localhost:3210" };
const jwt = (claims) => `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;
const HOSTED = "https://caiaretlxiljiiuoirtp.supabase.co";

describe("resolveLocalTarget", () => {
  it("with nothing set, is the Docker-less stack the config starts", () => {
    expect(resolveLocalTarget({}, DEFAULTS)).toEqual({ ...DEFAULTS, external: false });
  });

  it("accepts a running local stack (CI's supabase start) with its keys and app", () => {
    const t = resolveLocalTarget({
      E2E_SUPABASE_URL: "http://127.0.0.1:54321/", E2E_SUPABASE_ANON_KEY: jwt({ role: "anon", iss: "supabase-demo" }),
      E2E_SUPABASE_SERVICE_KEY: jwt({ role: "service_role", iss: "supabase-demo" }), E2E_LOCAL_BASE_URL: "http://localhost:3210",
    }, DEFAULTS);
    expect(t).toMatchObject({ supabaseUrl: "http://127.0.0.1:54321", appUrl: "http://localhost:3210", external: true });
  });

  it("refuses a hosted Supabase URL before anything runs", () => {
    expect(() => resolveLocalTarget({ E2E_SUPABASE_URL: HOSTED, E2E_SUPABASE_ANON_KEY: "a", E2E_SUPABASE_SERVICE_KEY: "s", E2E_LOCAL_BASE_URL: "http://localhost:3210" }, DEFAULTS))
      .toThrow(/refusing to run against Supabase URL/);
  });

  it("refuses a deployed app URL", () => {
    expect(() => resolveLocalTarget({ E2E_LOCAL_BASE_URL: "https://voinic.app" }, DEFAULTS)).toThrow(/refusing to run against app URL/);
  });

  it("refuses the app's own Supabase variables pointing anywhere but here", () => {
    expect(() => resolveLocalTarget({ NEXT_PUBLIC_SUPABASE_URL: HOSTED }, DEFAULTS)).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
    expect(() => resolveLocalTarget({ SUPABASE_URL: HOSTED }, DEFAULTS)).toThrow(/SUPABASE_URL/);
    expect(resolveLocalTarget({ NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54433" }, DEFAULTS).external).toBe(false);
  });

  it("refuses a key issued for a hosted project, even with a local URL", () => {
    expect(() => resolveLocalTarget({
      E2E_SUPABASE_URL: "http://127.0.0.1:54321", E2E_SUPABASE_ANON_KEY: jwt({ role: "anon" }),
      E2E_SUPABASE_SERVICE_KEY: jwt({ role: "service_role", ref: "caiaretlxiljiiuoirtp" }), E2E_LOCAL_BASE_URL: "http://localhost:3210",
    }, DEFAULTS)).toThrow(/hosted project "caiaretlxiljiiuoirtp"/);
  });

  it("needs both keys and the app URL for an external stack", () => {
    expect(() => resolveLocalTarget({ E2E_SUPABASE_URL: "http://127.0.0.1:54321" }, DEFAULTS)).toThrow(/ANON_KEY and E2E_SUPABASE_SERVICE_KEY/);
    expect(() => resolveLocalTarget({ E2E_SUPABASE_URL: "http://127.0.0.1:54321", E2E_SUPABASE_ANON_KEY: "a", E2E_SUPABASE_SERVICE_KEY: "s" }, DEFAULTS))
      .toThrow(/E2E_LOCAL_BASE_URL/);
  });
});

describe("loopbackUrl", () => {
  it.each([
    ["http://127.0.0.1@evil.example/", "userinfo that hides the real host"],
    ["http://localhost.evil.example", "a look-alike subdomain"],
    ["http://127.0.0.1.nip.io:3210", "a wildcard-DNS name for a loopback address"],
    ["http://localhost.:3210", "a trailing-dot name"],
    ["ftp://127.0.0.1/", "a non-http scheme"],
    ["not a url", "garbage"],
  ])("refuses %s (%s)", (raw) => {
    expect(() => loopbackUrl(raw, "x")).toThrow();
  });

  it.each(["http://localhost:3210", "http://127.0.0.1:54433", "http://[::1]:3210", "HTTP://LOCALHOST:3210/"])("accepts %s", (raw) => {
    expect(() => loopbackUrl(raw, "x")).not.toThrow();
  });
});

describe("isLocalRequest (the browser fence)", () => {
  it("lets this machine and inline data through", () => {
    for (const u of ["http://localhost:3210/_next/x.js", "http://127.0.0.1:54433/auth/v1/token", "data:image/png;base64,AA", "blob:http://localhost:3210/1"]) {
      expect(isLocalRequest(u)).toBe(true);
    }
  });
  it("stops everything else", () => {
    for (const u of [`${HOSTED}/auth/v1/token`, "https://www.googletagmanager.com/gtag/js", "https://res.cloudinary.com/x.jpg", "nonsense"]) {
      expect(isLocalRequest(u)).toBe(false);
    }
  });
});
