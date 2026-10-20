import "server-only";
import type { CalendarProvider } from "@healthapp/shared";
import type { CalendarProviderAdapter } from "./provider";
import { googleAdapter } from "./google";
import { microsoftAdapter } from "./microsoft";
import { parseTokenKey, type TokenKey } from "./token-crypto";

/**
 * Which calendar providers this deployment can connect, from its environment.
 * A provider is available only when ALL of these are set — otherwise the
 * coach's screen keeps saying "coming soon" and nothing half-works:
 *
 *   CALENDAR_TOKEN_KEY           32 random bytes, base64 (encrypts the tokens)
 *   SUPABASE_SERVICE_ROLE_KEY    the worker and the callback write tokens with it
 *   GOOGLE_CALENDAR_CLIENT_ID / GOOGLE_CALENDAR_CLIENT_SECRET
 *   MICROSOFT_CALENDAR_CLIENT_ID / MICROSOFT_CALENDAR_CLIENT_SECRET
 *
 * docs/CALENDAR_SETUP.md walks through creating each.
 */
function env(name: string): string | null {
  const v = process.env[name]?.trim();
  return v ? v : null;
}

export function tokenKeys(): TokenKey[] | null {
  try {
    const keys = [parseTokenKey(env("CALENDAR_TOKEN_KEY") ?? undefined, 1)];
    // a rotated key: the new one as CALENDAR_TOKEN_KEY_V2, the old one kept for reading
    const v2 = env("CALENDAR_TOKEN_KEY_V2");
    if (v2) keys.push(parseTokenKey(v2, 2));
    return keys;
  } catch {
    return null;
  }
}

/** The key new tokens are written with: the highest version configured. */
export function currentTokenKey(): TokenKey | null {
  const keys = tokenKeys();
  return keys ? keys.reduce((a, b) => (b.version > a.version ? b : a)) : null;
}

export function calendarAdapter(provider: CalendarProvider): CalendarProviderAdapter | null {
  if (!tokenKeys() || !env("SUPABASE_SERVICE_ROLE_KEY")) return null;
  if (provider === "google") {
    const id = env("GOOGLE_CALENDAR_CLIENT_ID");
    const secret = env("GOOGLE_CALENDAR_CLIENT_SECRET");
    return id && secret ? googleAdapter(id, secret) : null;
  }
  const id = env("MICROSOFT_CALENDAR_CLIENT_ID");
  const secret = env("MICROSOFT_CALENDAR_CLIENT_SECRET");
  return id && secret ? microsoftAdapter(id, secret) : null;
}

/** The callback address the provider sends the coach back to (must match the app registration). */
export function calendarRedirectUri(provider: CalendarProvider, origin: string): string {
  const base = env("NEXT_PUBLIC_SITE_URL") ?? origin;
  return `${base.replace(/\/$/, "")}/api/calendar/${provider}/callback`;
}
