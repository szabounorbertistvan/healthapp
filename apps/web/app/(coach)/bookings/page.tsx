import Link from "next/link";
import { Suspense } from "react";
import { MarketplaceTabs } from "@/components/marketplace-tabs";
import { getI18n } from "@/lib/i18n/server";
import { getCoachBookings } from "@/lib/booking-data";
import { COACH_BOOKING_SCOPES, type CoachBookingScope } from "@/lib/booking";
import { CoachBookingList } from "@/components/bookings";

/**
 * /bookings — the coach's appointments (20261105100000): upcoming first, then
 * the ones waiting for an answer, the confirmed ones, the ones that started
 * and need an outcome, and the record. Under (coach), so the layout keeps
 * clients out. The tab lives in the URL (?tab=), plain links.
 */
export default async function BookingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const [{ t }, { tab: raw }] = await Promise.all([getI18n(), searchParams]);
  const tab: CoachBookingScope = (COACH_BOOKING_SCOPES as string[]).includes(raw ?? "") ? (raw as CoachBookingScope) : "upcoming";
  const b = t.coachProfile.bookings;
  const rows = await getCoachBookings(tab);

  return (
    <div className="mx-auto max-w-3xl">
      <Suspense><MarketplaceTabs /></Suspense>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-extrabold tracking-tight sm:text-[28px]">{b.title}</h1>
          <p className="mt-1 max-w-[62ch] text-[13.5px] text-ink-soft">{b.hint}</p>
        </div>
        <Link href="/bookings/availability" data-testid="availability-link"
          className="inline-flex h-10 items-center rounded-full bg-surface px-4 text-[13.5px] font-semibold text-ink-soft hover:text-ink">
          {b.availabilityLink}
        </Link>
      </header>
      <nav aria-label={b.title} className="mt-5 flex flex-wrap gap-1.5">
        {COACH_BOOKING_SCOPES.map((k) => (
          <Link key={k} href={k === "upcoming" ? "/bookings" : `/bookings?tab=${k}`} aria-current={tab === k ? "page" : undefined}
            className={`inline-flex h-10 items-center rounded-full px-4 text-[13.5px] font-semibold ${
              tab === k ? "bg-accent text-accent-fg" : "bg-surface text-ink-soft hover:text-ink"}`}>
            {b.tabs[k]}
          </Link>
        ))}
      </nav>
      <div className="mt-4">
        <CoachBookingList rows={rows} />
      </div>
    </div>
  );
}
