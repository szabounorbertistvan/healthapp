/**
 * Microsoft (Outlook / Microsoft 365), through Calendars.ReadBasic — the
 * narrowest Graph scope that lists calendars and their events' times; it
 * excludes bodies and attendees. Of each event only start, end, showAs and
 * isAllDay are requested ($select), and only "busy" ones are kept as
 * intervals. Microsoft has no free/busy-only scope (see CALENDAR_PROVIDER_INFO).
 *
 * Needs an Entra ID app registration (any account type) with the redirect URI
 * <site>/api/calendar/microsoft/callback — see docs/CALENDAR_SETUP.md.
 */
import { CALENDAR_PROVIDER_INFO, allDayToInterval, type BusyInterval } from "@healthapp/shared";
import type { CalendarProviderAdapter, ExternalCalendar, TokenSet } from "./provider";
import { emailFromIdToken, form, providerJson } from "./http";

type TokenAnswer = { access_token: string; refresh_token?: string; expires_in: number; scope?: string; id_token?: string };
type GraphEvent = { start?: { dateTime: string; timeZone: string }; end?: { dateTime: string; timeZone: string }; showAs?: string; isAllDay?: boolean };

const AUTH = "https://login.microsoftonline.com/common/oauth2/v2.0";
const GRAPH = "https://graph.microsoft.com/v1.0";

/** Graph's "2026-12-07T09:00:00.0000000" in UTC (we ask for UTC) → an instant. */
function utc(dateTime: string): Date {
  return new Date(/[zZ]|[+-]\d\d:\d\d$/.test(dateTime) ? dateTime : `${dateTime}Z`);
}

export function microsoftAdapter(clientId: string, clientSecret: string): CalendarProviderAdapter {
  const scopes = [...CALENDAR_PROVIDER_INFO.microsoft.scopes, "openid", "email"];
  const tokens = (t: TokenAnswer): TokenSet => ({
    accessToken: t.access_token,
    refreshToken: t.refresh_token ?? null,
    expiresAt: new Date(Date.now() + Math.max(60, t.expires_in) * 1000),
    scopes: (t.scope ?? scopes.join(" ")).split(" ").filter(Boolean),
  });

  return {
    provider: "microsoft",

    authorizationUrl({ state, redirectUri, codeChallenge }) {
      const q = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        response_mode: "query",
        scope: scopes.join(" "),
        state,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        prompt: "select_account",
      });
      return `${AUTH}/authorize?${q}`;
    },

    async exchangeCode({ code, redirectUri, codeVerifier }) {
      const t = await providerJson<TokenAnswer>(`${AUTH}/token`, form({
        client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri,
        grant_type: "authorization_code", code_verifier: codeVerifier, scope: scopes.join(" "),
      }), true);
      return { ...tokens(t), accountLabel: emailFromIdToken(t.id_token) };
    },

    async refresh(refreshToken) {
      const t = await providerJson<TokenAnswer>(`${AUTH}/token`, form({
        client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken,
        grant_type: "refresh_token", scope: scopes.join(" "),
      }), true);
      return tokens(t);
    },

    async listCalendars(accessToken) {
      const out: ExternalCalendar[] = [];
      let next: string | undefined = `${GRAPH}/me/calendars?$select=id,name,isDefaultCalendar&$top=100`;
      while (next && out.length < 500) {
        const data: { value?: { id: string; name?: string; isDefaultCalendar?: boolean }[]; "@odata.nextLink"?: string } =
          await providerJson(next, { headers: { Authorization: `Bearer ${accessToken}` } });
        for (const c of data.value ?? []) out.push({ id: c.id, name: c.name ?? null, primary: c.isDefaultCalendar === true, timeZone: null });
        next = data["@odata.nextLink"];
      }
      return out;
    },

    async freeBusy(accessToken, calendarIds, window: BusyInterval) {
      const result: { calendarId: string; busy: BusyInterval[] }[] = [];
      for (const id of calendarIds) {
        const busy: BusyInterval[] = [];
        const q = new URLSearchParams({
          startDateTime: window.start.toISOString(),
          endDateTime: window.end.toISOString(),
          $select: "start,end,showAs,isAllDay",
          $top: "200",
        });
        let next: string | undefined = `${GRAPH}/me/calendars/${encodeURIComponent(id)}/calendarView?${q}`;
        let pages = 0;
        while (next && pages < 25) {
          const data: { value?: GraphEvent[]; "@odata.nextLink"?: string } = await providerJson(next, {
            headers: { Authorization: `Bearer ${accessToken}`, Prefer: 'outlook.timezone="UTC"' },
          });
          for (const e of data.value ?? []) {
            if (!e.start || !e.end || e.showAs === "free" || e.showAs === "workingElsewhere") continue;
            busy.push(e.isAllDay
              ? allDayToInterval(e.start.dateTime.slice(0, 10), e.end.dateTime.slice(0, 10), "UTC")
              : { start: utc(e.start.dateTime), end: utc(e.end.dateTime) });
          }
          next = data["@odata.nextLink"];
          pages++;
        }
        result.push({ calendarId: id, busy });
      }
      return result;
    },

    async revoke() {
      // Microsoft identity has no per-grant revocation endpoint; the stored token is purged and the coach removes the app in their account
    },
  };
}
