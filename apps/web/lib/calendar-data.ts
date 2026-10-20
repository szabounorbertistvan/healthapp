import "server-only";
import type { CalendarConnectionStatus, CalendarErrorCode, CalendarProvider } from "@healthapp/shared";
import { liveUser } from "@/lib/supabase/server";
import { calendarAdapter } from "@/lib/calendar/registry";

/**
 * The signed-in coach's calendar connections (my_calendar_integrations(),
 * 20261111130000): status and health, the calendars and whether each blocks
 * booking times, a count of busy periods ahead. No token, no sync state and
 * no event ever reaches this shape — the function does not return them.
 */
export type CalendarIntegration = {
  id: string;
  provider: CalendarProvider;
  status: CalendarConnectionStatus;
  account_label: string | null;
  last_synced_at: string | null;
  last_error_code: CalendarErrorCode | null;
  connected_at: string | null;
  sources: { id: string; name: string | null; is_primary: boolean; affects_availability: boolean }[];
  upcoming_busy: number;
};

/** Empty for anyone signed out, and on a database without the migration (PGRST202). */
export async function getMyCalendarIntegrations(): Promise<CalendarIntegration[]> {
  const live = await liveUser();
  if (!live) return [];
  const { data, error } = await live.supabase.rpc("my_calendar_integrations");
  if (error) {
    if (error.code !== "PGRST202") console.error("calendar integrations:", error.message);
    return [];
  }
  return (data ?? []) as CalendarIntegration[];
}

/**
 * Whether a provider's connect flow is configured in this deployment (its
 * OAuth client, the token key and the service key — lib/calendar/registry.ts).
 * Until it is, the screen says "coming soon" rather than offering a button
 * that cannot work.
 */
export function calendarConnectAvailable(provider: CalendarProvider): boolean {
  return calendarAdapter(provider) !== null;
}
