"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CALENDAR_PROVIDERS, calendarConnectionView, type CalendarProvider } from "@healthapp/shared";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { SMALL_BUTTON } from "@/lib/form-classes";
import type { CalendarIntegration } from "@/lib/calendar-data";
import { disconnectCalendar, setCalendarSourceAvailability } from "@/app/calendar-actions";
import { Switch } from "./ui";

/**
 * Calendar / Integrations on /bookings/availability (20261111130000): one row
 * per provider — not connected, connecting, connected (last sync, the
 * calendars that block booking times), syncing, a sync problem, reconnect
 * required — and Disconnect. No secret is ever in these props: they come from
 * my_calendar_integrations(), which has none to give.
 *
 * Connect is "coming soon" until a provider's OAuth flow exists
 * (lib/calendar/provider.ts) — never a button that cannot work, never a fake
 * connection.
 */
export function CalendarIntegrations({ connections, connectable }: {
  connections: CalendarIntegration[];
  connectable: Record<CalendarProvider, boolean>;
}) {
  const { t, locale } = useI18n();
  const c = t.coachProfile.bookings.availability.calendar;
  return (
    <div className="grid gap-3" data-testid="calendar-integrations">
      <p className="max-w-[62ch] text-[13px] text-ink-soft">{c.privacy}</p>
      <ul className="grid gap-3">
        {CALENDAR_PROVIDERS.map((provider) => {
          const conn = connections.find((x) => x.provider === provider) ?? null;
          return (
            <li key={provider} className="rounded-3xl bg-surface p-5" data-testid="calendar-provider" data-provider={provider}
              data-status={conn?.status ?? "not_connected"}>
              {conn ? <Connected conn={conn} locale={locale} /> : (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold">{c.providers[provider]}</p>
                    <p className="text-[13px] text-ink-faint">{c.statuses.not_connected}</p>
                  </div>
                  {connectable[provider] ? null : (
                    <span className="flex flex-col items-end gap-1">
                      <span className={`${SMALL_BUTTON} h-10 cursor-not-allowed px-4 opacity-60`} aria-disabled="true" data-testid="calendar-connect-soon">
                        {c.comingSoon}
                      </span>
                    </span>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {Object.values(connectable).some(Boolean) ? null : <p className="text-[12.5px] text-ink-faint">{c.comingSoonHint}</p>}
    </div>
  );
}

function Connected({ conn, locale }: { conn: CalendarIntegration; locale: "en" | "ro" }) {
  const { t } = useI18n();
  const c = t.coachProfile.bookings.availability.calendar;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const view = calendarConnectionView(conn);
  const when = (iso: string) => new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

  const run = (fn: () => Promise<{ ok: boolean }>) => start(async () => {
    setError(null);
    const result = await fn();
    if (!result.ok) setError(c.failed);
    else router.refresh();
  });

  const tone = view.state === "connected" ? "bg-accent-soft text-accent-ink"
    : view.state === "error" || view.state === "reauth_required" ? "bg-warn-soft text-warn" : "bg-bg text-ink-soft";

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{c.providers[conn.provider]}</p>
          {conn.account_label ? <p className="text-[13px] text-ink-faint">{conn.account_label}</p> : null}
        </div>
        <span className={`rounded-full px-3 py-1 text-[12px] font-semibold ${tone}`} data-testid="calendar-status">
          {c.statuses[view.state]}
        </span>
      </div>

      <p className="text-[13px] text-ink-soft">
        {view.state === "connected"
          ? view.lastSyncedAt ? fill(c.lastSync, { when: when(view.lastSyncedAt) }) : c.neverSynced
          : view.state === "error" || view.state === "reauth_required" ? c.errors[view.code] : c.neverSynced}
        {conn.upcoming_busy > 0 ? ` · ${fill(c.busyAhead, { n: conn.upcoming_busy })}` : ""}
      </p>

      {conn.sources.length > 0 ? (
        <fieldset className="grid gap-2" disabled={pending}>
          <legend className="text-[12px] font-semibold uppercase tracking-wider text-ink-faint">{c.calendars}</legend>
          {conn.sources.map((s) => (
            <Switch key={s.id} checked={s.affects_availability} label={s.name ?? "—"}
              onChange={(on) => run(() => setCalendarSourceAvailability(s.id, on))}
              onLabel={t.coachProfile.wizard.on} offLabel={t.coachProfile.wizard.off} />
          ))}
        </fieldset>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {confirming ? (
          <>
            <p className="w-full text-[13px] text-ink-soft">{fill(c.disconnectConfirm, { provider: c.providers[conn.provider] })}</p>
            <button type="button" className={`${SMALL_BUTTON} h-10 px-4 text-risk`} disabled={pending} data-testid="calendar-disconnect-confirm"
              onClick={() => run(() => disconnectCalendar(conn.id))}>{c.disconnect}</button>
            <button type="button" className={`${SMALL_BUTTON} h-10 px-4`} onClick={() => setConfirming(false)}>
              {t.coachProfile.publicPage.cancel}
            </button>
          </>
        ) : (
          <button type="button" className={`${SMALL_BUTTON} h-10 px-4`} onClick={() => setConfirming(true)} data-testid="calendar-disconnect">
            {c.disconnect}
          </button>
        )}
      </div>
      {error ? <p role="alert" className="text-[13px] text-risk">{error}</p> : null}
    </div>
  );
}
