/**
 * The contract every external calendar provider implements (Google Calendar,
 * Microsoft Outlook, …). The booking system never talks to a provider: the
 * sync worker (lib/calendar/sync.ts) does, through this interface, and hands
 * the database busy intervals only (calendar_sync_apply, 20261111130000).
 *
 * NOT IMPLEMENTED YET: no adapter exists in this codebase. One needs the
 * provider's app registration (client id / secret, redirect URI, consent
 * screen review for Google's scopes), a callback route that stores the
 * encrypted tokens with calendar_connection_open(), and a worker with the
 * service-role key that runs syncConnection(). Until then every coach is
 * "not connected" and booking is unchanged — see docs/ENGINES.md §Calendars.
 */
import type { BusyInterval, CalendarErrorCode, CalendarProvider } from "@healthapp/shared";

export type TokenSet = {
  accessToken: string;
  /** Absent when the provider did not rotate it: keep the stored one. */
  refreshToken?: string | null;
  expiresAt: Date;
  scopes: string[];
};

/** A calendar the coach can choose (from the provider's calendar list). Name and id only. */
export type ExternalCalendar = { id: string; name: string | null; primary: boolean; timeZone: string | null };

/** Every provider failure, reduced to the codes the database stores (calendar_sync_failed). Never the provider's text. */
export class CalendarProviderError extends Error {
  constructor(public readonly code: CalendarErrorCode, public readonly retryAfterSeconds: number | null = null) {
    super(code);
    this.name = "CalendarProviderError";
  }
}

export interface CalendarProviderAdapter {
  readonly provider: CalendarProvider;
  /** The consent URL, with the minimum scopes (CALENDAR_PROVIDER_INFO) and an anti-forgery `state`. */
  authorizationUrl(input: { state: string; redirectUri: string; codeChallenge: string }): string;
  exchangeCode(input: { code: string; redirectUri: string; codeVerifier: string }): Promise<TokenSet & { accountLabel: string | null }>;
  refresh(refreshToken: string): Promise<TokenSet>;
  listCalendars(accessToken: string): Promise<ExternalCalendar[]>;
  /**
   * Busy time of these calendars in the window, as absolute intervals
   * (all-day events converted in the calendar's zone — allDayToInterval).
   * Implementations must not return or keep anything else about an event.
   */
  freeBusy(accessToken: string, calendarIds: string[], window: BusyInterval): Promise<{ calendarId: string; busy: BusyInterval[] }[]>;
  /** Best effort; a provider without per-grant revocation resolves without doing anything. */
  revoke(token: string): Promise<void>;
}
