import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { CALENDAR_PROVIDERS, type CalendarProvider } from "@healthapp/shared";

/**
 * The OAuth round trip's own state, held in one short-lived httpOnly cookie
 * scoped to /api/calendar: which provider, the anti-forgery `state` (echoed by
 * the provider, compared here) and the PKCE verifier (only its hash went to
 * the provider). Ten minutes, then the coach starts again.
 */
export const OAUTH_COOKIE = "voinic-calendar-oauth";
export const OAUTH_COOKIE_MAX_AGE = 600;

export type OAuthPending = { provider: CalendarProvider; state: string; verifier: string };

export function isCalendarProvider(x: string): x is CalendarProvider {
  return (CALENDAR_PROVIDERS as readonly string[]).includes(x);
}

export function newOAuthPending(provider: CalendarProvider): OAuthPending & { challenge: string } {
  const state = randomBytes(24).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { provider, state, verifier, challenge };
}

export function encodePending(p: OAuthPending): string {
  return Buffer.from(JSON.stringify(p), "utf8").toString("base64url");
}

export function decodePending(raw: string | undefined): OAuthPending | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<OAuthPending>;
    if (typeof p.state !== "string" || typeof p.verifier !== "string" || typeof p.provider !== "string" || !isCalendarProvider(p.provider)) return null;
    return { provider: p.provider, state: p.state, verifier: p.verifier };
  } catch {
    return null;
  }
}

/** The state the provider echoed is the one this browser started with. */
export function stateMatches(expected: string, got: string | null): boolean {
  if (!got) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(got);
  return a.length === b.length && timingSafeEqual(a, b);
}
