/**
 * Google Calendar, through the narrowest scopes that answer "is the coach
 * busy?": calendar.calendarlist.readonly (names, to let the coach choose) and
 * calendar.freebusy (busy intervals — never an event's title, people or place).
 * Plus openid/email, only to label the connection with the account's address.
 *
 * Needs a Google Cloud OAuth client (web application) with the redirect URI
 * <site>/api/calendar/google/callback — see docs/CALENDAR_SETUP.md.
 */
import { CALENDAR_PROVIDER_INFO, type BusyInterval } from "@healthapp/shared";
import type { CalendarProviderAdapter, ExternalCalendar, TokenSet } from "./provider";
import { emailFromIdToken, form, providerJson } from "./http";

type TokenAnswer = { access_token: string; refresh_token?: string; expires_in: number; scope?: string; id_token?: string };

export function googleAdapter(clientId: string, clientSecret: string): CalendarProviderAdapter {
  const scopes = [...CALENDAR_PROVIDER_INFO.google.scopes, "openid", "email"];
  const tokens = (t: TokenAnswer): TokenSet => ({
    accessToken: t.access_token,
    refreshToken: t.refresh_token ?? null,
    expiresAt: new Date(Date.now() + Math.max(60, t.expires_in) * 1000),
    scopes: (t.scope ?? scopes.join(" ")).split(" ").filter(Boolean),
  });

  return {
    provider: "google",

    authorizationUrl({ state, redirectUri, codeChallenge }) {
      const q = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: scopes.join(" "),
        // a refresh token every time, so a reconnect always has one
        access_type: "offline",
        prompt: "consent",
        include_granted_scopes: "false",
        state,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
      });
      return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
    },

    async exchangeCode({ code, redirectUri, codeVerifier }) {
      const t = await providerJson<TokenAnswer>("https://oauth2.googleapis.com/token", form({
        code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri,
        grant_type: "authorization_code", code_verifier: codeVerifier,
      }), true);
      return { ...tokens(t), accountLabel: emailFromIdToken(t.id_token) };
    },

    async refresh(refreshToken) {
      const t = await providerJson<TokenAnswer>("https://oauth2.googleapis.com/token", form({
        refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret, grant_type: "refresh_token",
      }), true);
      return tokens(t);
    },

    async listCalendars(accessToken) {
      const out: ExternalCalendar[] = [];
      let page: string | undefined;
      do {
        const q = new URLSearchParams({ minAccessRole: "freeBusyReader", maxResults: "250", fields: "nextPageToken,items(id,summary,primary,timeZone)" });
        if (page) q.set("pageToken", page);
        const data = await providerJson<{ nextPageToken?: string; items?: { id: string; summary?: string; primary?: boolean; timeZone?: string }[] }>(
          `https://www.googleapis.com/calendar/v3/users/me/calendarList?${q}`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );
        for (const c of data.items ?? []) out.push({ id: c.id, name: c.summary ?? null, primary: c.primary === true, timeZone: c.timeZone ?? null });
        page = data.nextPageToken;
      } while (page && out.length < 500);
      return out;
    },

    async freeBusy(accessToken, calendarIds, window: BusyInterval) {
      const result: { calendarId: string; busy: BusyInterval[] }[] = [];
      // freeBusy answers at most 50 calendars per call
      for (let i = 0; i < calendarIds.length; i += 50) {
        const ids = calendarIds.slice(i, i + 50);
        const data = await providerJson<{ calendars?: Record<string, { busy?: { start: string; end: string }[]; errors?: unknown[] }> }>(
          "https://www.googleapis.com/calendar/v3/freeBusy",
          {
            method: "POST",
            headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ timeMin: window.start.toISOString(), timeMax: window.end.toISOString(), items: ids.map((id) => ({ id })) }),
          },
        );
        for (const id of ids) {
          const cal = data.calendars?.[id];
          if (!cal || (cal.errors && cal.errors.length > 0)) continue; // not found / no access: nothing to block
          result.push({ calendarId: id, busy: (cal.busy ?? []).map((b) => ({ start: new Date(b.start), end: new Date(b.end) })) });
        }
      }
      return result;
    },

    async revoke(token) {
      try {
        await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: "POST", signal: AbortSignal.timeout(10_000) });
      } catch {
        // best effort: the coach can also remove the app in their Google account
      }
    },
  };
}
