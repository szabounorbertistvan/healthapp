import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { errorForStatus, emailFromIdToken } from "./http";
import { googleAdapter } from "./google";
import { microsoftAdapter } from "./microsoft";
import { decodePending, encodePending, newOAuthPending, stateMatches } from "./oauth";

const window = { start: new Date("2026-12-07T00:00:00Z"), end: new Date("2026-12-14T00:00:00Z") };

function answer(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

afterEach(() => vi.unstubAllGlobals());

describe("provider errors", () => {
  it("maps statuses to stored codes, never text", () => {
    expect(errorForStatus(401, null).code).toBe("token_expired");
    expect(errorForStatus(400, null, true).code).toBe("token_revoked");
    expect(errorForStatus(403, null).code).toBe("permission_denied");
    expect(errorForStatus(404, null).code).toBe("calendar_not_found");
    expect(errorForStatus(503, null).code).toBe("provider_unavailable");
    const limited = errorForStatus(429, "120");
    expect(limited.code).toBe("rate_limited");
    expect(limited.retryAfterSeconds).toBe(120);
  });

  it("reads the account email from an id_token payload", () => {
    const payload = Buffer.from(JSON.stringify({ email: "coach@example.com" })).toString("base64url");
    expect(emailFromIdToken(`h.${payload}.s`)).toBe("coach@example.com");
    expect(emailFromIdToken("not-a-token")).toBeNull();
  });
});

describe("oauth round trip", () => {
  it("keeps provider, state and verifier in the cookie and compares the echoed state", () => {
    const p = newOAuthPending("google");
    const back = decodePending(encodePending(p));
    expect(back).toEqual({ provider: "google", state: p.state, verifier: p.verifier });
    expect(stateMatches(p.state, p.state)).toBe(true);
    expect(stateMatches(p.state, "forged")).toBe(false);
    expect(stateMatches(p.state, null)).toBe(false);
    expect(decodePending("garbage")).toBeNull();
  });
});

describe("google", () => {
  const g = googleAdapter("client-id", "secret");

  it("asks for the narrow scopes, offline access and PKCE", () => {
    const url = new URL(g.authorizationUrl({ state: "st", redirectUri: "https://voinic.fit/api/calendar/google/callback", codeChallenge: "ch" }));
    expect(url.hostname).toBe("accounts.google.com");
    expect(url.searchParams.get("scope")).toContain("calendar.freebusy");
    expect(url.searchParams.get("scope")).not.toContain("calendar.readonly ");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe("st");
  });

  it("returns busy intervals per calendar and skips calendars with errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => answer({
      calendars: {
        primary: { busy: [{ start: "2026-12-08T09:00:00Z", end: "2026-12-08T10:00:00Z" }] },
        gone: { errors: [{ reason: "notFound" }] },
      },
    })));
    const out = await g.freeBusy("tok", ["primary", "gone"], window);
    expect(out).toEqual([{ calendarId: "primary", busy: [{ start: new Date("2026-12-08T09:00:00Z"), end: new Date("2026-12-08T10:00:00Z") }] }]);
  });

  it("turns a refused refresh into token_revoked", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => answer({ error: "invalid_grant" }, 400)));
    await expect(g.refresh("old")).rejects.toMatchObject({ code: "token_revoked" });
  });
});

describe("microsoft", () => {
  const m = microsoftAdapter("client-id", "secret");

  it("keeps only busy events, in UTC, all-day ones as whole days", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => answer({
      value: [
        { start: { dateTime: "2026-12-08T09:00:00.0000000", timeZone: "UTC" }, end: { dateTime: "2026-12-08T10:30:00.0000000", timeZone: "UTC" }, showAs: "busy", isAllDay: false },
        { start: { dateTime: "2026-12-09T09:00:00.0000000", timeZone: "UTC" }, end: { dateTime: "2026-12-09T10:00:00.0000000", timeZone: "UTC" }, showAs: "free", isAllDay: false },
        { start: { dateTime: "2026-12-10T00:00:00.0000000", timeZone: "UTC" }, end: { dateTime: "2026-12-11T00:00:00.0000000", timeZone: "UTC" }, showAs: "oof", isAllDay: true },
      ],
    })));
    const [cal] = await m.freeBusy("tok", ["cal-1"], window);
    expect(cal?.busy).toEqual([
      { start: new Date("2026-12-08T09:00:00Z"), end: new Date("2026-12-08T10:30:00Z") },
      { start: new Date("2026-12-10T00:00:00Z"), end: new Date("2026-12-11T00:00:00Z") },
    ]);
  });

  it("lists calendars and marks the default one primary", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => answer({ value: [{ id: "a", name: "Calendar", isDefaultCalendar: true }, { id: "b", name: "Gym" }] })));
    expect(await m.listCalendars("tok")).toEqual([
      { id: "a", name: "Calendar", primary: true, timeZone: null },
      { id: "b", name: "Gym", primary: false, timeZone: null },
    ]);
  });
});
