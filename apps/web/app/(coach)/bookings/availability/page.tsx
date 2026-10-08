import Link from "next/link";
import { Suspense } from "react";
import { MarketplaceTabs } from "@/components/marketplace-tabs";
import { zonedDate } from "@healthapp/shared";
import { getI18n } from "@/lib/i18n/server";
import { getMyAvailability } from "@/lib/booking-data";
import { ServiceBookingSettings, TimeOff, WeeklyHours, ZoneNote } from "@/components/availability-editor";
import { calendarConnectAvailable, getMyCalendarIntegrations } from "@/lib/calendar-data";
import { CalendarIntegrations } from "@/components/calendar-integrations";

/**
 * /bookings/availability — when the coach can be booked (20261105100000):
 * the weekly hours, time off, and which services are bookable and how. All
 * of it in the coach's own zone (users.timezone), which is named at the top.
 * Calendar connections (20261111130000) close the page: external busy time
 * blocks slots like time off does.
 */
export default async function AvailabilityPage() {
  const [{ t }, data, calendars] = await Promise.all([getI18n(), getMyAvailability(), getMyCalendarIntegrations()]);
  const a = t.coachProfile.bookings.availability;
  const today = zonedDate(new Date(), data.timezone);
  const section = "font-display text-lg font-bold tracking-tight";

  return (
    <div className="mx-auto max-w-3xl">
      <Suspense><MarketplaceTabs /></Suspense>
      <Link href="/bookings" className="text-[13px] font-semibold text-ink-faint hover:text-ink">← {a.back}</Link>
      <header className="mt-2">
        <h1 className="font-display text-2xl font-extrabold tracking-tight sm:text-[28px]">{a.title}</h1>
        <p className="mt-1 max-w-[62ch] text-[13.5px] text-ink-soft">{a.hint}</p>
        <div className="mt-2"><ZoneNote timezone={data.timezone} /></div>
      </header>

      <section className="mt-6" aria-label={a.week}>
        <h2 className={section}>{a.week}</h2>
        <div className="mt-3"><WeeklyHours blocks={data.blocks} /></div>
      </section>

      <section className="mt-8" aria-label={a.timeOff}>
        <h2 className={section}>{a.timeOff}</h2>
        <p className="mt-1 max-w-[62ch] text-[13px] text-ink-soft">{a.timeOffHint}</p>
        <div className="mt-3"><TimeOff exceptions={data.exceptions} today={today} /></div>
      </section>

      <section className="mt-8" aria-label={a.services}>
        <h2 className={section}>{a.services}</h2>
        <p className="mt-1 max-w-[62ch] text-[13px] text-ink-soft">{a.servicesHint}</p>
        <div className="mt-3">
          {!data.hasProfile ? (
            <p className="text-[13px] text-ink-faint">
              {a.noProfile} <Link href="/settings/coach-profile" className="font-semibold text-accent-ink hover:underline">→</Link>
            </p>
          ) : data.services.length === 0 ? (
            <p className="text-[13px] text-ink-faint">{a.noServices}</p>
          ) : (
            <ServiceBookingSettings services={data.services} />
          )}
        </div>
      </section>

      <section className="mt-8" aria-label={a.calendar.title}>
        <h2 className={section}>{a.calendar.title}</h2>
        <p className="mt-1 max-w-[62ch] text-[13px] text-ink-soft">{a.calendar.hint}</p>
        <div className="mt-3">
          <CalendarIntegrations connections={calendars}
            connectable={{ google: calendarConnectAvailable("google"), microsoft: calendarConnectAvailable("microsoft") }} />
        </div>
      </section>
    </div>
  );
}
