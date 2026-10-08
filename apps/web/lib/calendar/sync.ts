/**
 * One sync of one connection, provider-agnostic: refresh the access token if
 * it is about to expire, read the calendar list and the busy time of the
 * calendars that affect availability, and hand the result to the database in
 * one call (calendar_sync_apply — an atomic replace of the window). Any
 * failure becomes one stored code (calendar_sync_failed): credentials the
 * provider refuses → reconnect required; anything else → retried later.
 *
 * Everything outside is injected (the provider adapter, the store, the
 * clock), so the logic is unit-tested without a provider or a database
 * (sync.test.ts). The store is implemented by the worker with the
 * service-role client; it is the only thing that ever sees a decrypted token.
 */
import {
  needsReconnect, nextSafetySync, normalizeBusy, syncWindow,
  type BusyInterval, type CalendarErrorCode,
} from "@healthapp/shared";
import { CalendarProviderError, type CalendarProviderAdapter, type ExternalCalendar, type TokenSet } from "./provider";

export type StoredCredentials = { accessToken: string; refreshToken: string | null; expiresAt: Date | null };

export interface CalendarSyncStore {
  credentials(connectionId: string): Promise<StoredCredentials | null>;
  saveTokens(connectionId: string, tokens: TokenSet): Promise<void>;
  /** External ids of the connection's calendars that affect availability (the coach's choice). */
  affectingCalendars(connectionId: string): Promise<string[]>;
  apply(input: {
    connectionId: string; calendars: ExternalCalendar[];
    busy: { calendar: string; start: string; end: string }[]; window: BusyInterval; nextSyncAt: Date;
  }): Promise<void>;
  fail(connectionId: string, code: CalendarErrorCode, retryAt: Date | null): Promise<void>;
}

export type SyncOutcome =
  | { ok: true; busyIntervals: number; calendars: number }
  | { ok: false; code: CalendarErrorCode; reconnect: boolean };

/** Refresh this long before the access token expires. */
const REFRESH_MARGIN_MS = 2 * 60_000;

export async function syncConnection(
  connectionId: string,
  deps: { adapter: CalendarProviderAdapter; store: CalendarSyncStore; now?: () => Date; hasPushChannel?: boolean },
): Promise<SyncOutcome> {
  const now = deps.now ?? (() => new Date());
  try {
    const creds = await deps.store.credentials(connectionId);
    if (!creds) throw new CalendarProviderError("token_revoked");

    let accessToken = creds.accessToken;
    if (!creds.expiresAt || creds.expiresAt.getTime() - now().getTime() < REFRESH_MARGIN_MS) {
      if (!creds.refreshToken) throw new CalendarProviderError("token_expired");
      const fresh = await deps.adapter.refresh(creds.refreshToken);
      await deps.store.saveTokens(connectionId, { ...fresh, refreshToken: fresh.refreshToken ?? creds.refreshToken });
      accessToken = fresh.accessToken;
    }

    const calendars = await deps.adapter.listCalendars(accessToken);
    const known = new Set(calendars.map((c) => c.id));
    // the coach's choice, among the calendars that still exist; a new connection starts from the primary one
    const chosen = (await deps.store.affectingCalendars(connectionId)).filter((id) => known.has(id));
    const affecting = chosen.length ? chosen : calendars.filter((c) => c.primary).map((c) => c.id);

    const window = syncWindow(now());
    const perCalendar = affecting.length ? await deps.adapter.freeBusy(accessToken, affecting, window) : [];
    const busy = perCalendar.flatMap((c) => normalizeBusy(c.busy, window)
      .map((b) => ({ calendar: c.calendarId, start: b.start.toISOString(), end: b.end.toISOString() })));

    await deps.store.apply({ connectionId, calendars, busy, window, nextSyncAt: nextSafetySync(now(), deps.hasPushChannel ?? false) });
    return { ok: true, busyIntervals: busy.length, calendars: calendars.length };
  } catch (e) {
    const code: CalendarErrorCode = e instanceof CalendarProviderError ? e.code : "unknown";
    const reconnect = needsReconnect(code);
    const retryAfter = e instanceof CalendarProviderError && e.retryAfterSeconds ? e.retryAfterSeconds * 1000 : 30 * 60_000;
    await deps.store.fail(connectionId, code, reconnect ? null : new Date(now().getTime() + retryAfter));
    return { ok: false, code, reconnect };
  }
}
