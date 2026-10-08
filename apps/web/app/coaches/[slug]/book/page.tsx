import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { addDays, zonedDate } from "@healthapp/shared";
import { APP_NAME } from "@/lib/brand";
import { fill } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import { currentUserId } from "@/lib/supabase/server";
import { getPublicCoachProfile } from "@/lib/coach-profile-data";
import { getBookableServices, getBookingSlots } from "@/lib/booking-data";
import { formatPrice } from "@/lib/coach-onboarding";
import { BookingPicker } from "@/components/booking-picker";
import { MarketplaceTracker } from "@/components/marketplace-tracker";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const [{ t }, { slug }] = await Promise.all([getI18n(), params]);
  const profile = await getPublicCoachProfile(slug);
  const b = t.coachProfile.bookings.book;
  return {
    title: profile ? `${b.title} ${fill(b.with, { name: profile.display_name })} | ${APP_NAME}` : APP_NAME,
    robots: { index: false, follow: false },
  };
}

/**
 * /coaches/[slug]/book?service=…&from=YYYY-MM-DD — booking one service
 * (20261105100000): a week of the coach's days, the free times of the chosen
 * one, confirm. Anyone may look (middleware lets /coaches/* through); only a
 * signed-in reader can confirm — anonymous visitors are sent to sign in and
 * back here. Every time comes from coach_booking_slots() in the coach's zone
 * and is checked again by book_service() on confirm.
 */
export default async function BookPage({
  params, searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ service?: string; from?: string; at?: string }>;
}) {
  const [{ t, locale }, { slug }, query, userId] = await Promise.all([getI18n(), params, searchParams, currentUserId()]);
  const b = t.coachProfile.bookings.book;
  const [profile, bookable] = await Promise.all([getPublicCoachProfile(slug), getBookableServices(slug)]);
  if (!profile || profile.slug !== slug) notFound();

  const wanted = query.service && UUID.test(query.service) ? query.service : null;
  const booking = bookable.find((s) => s.service_id === wanted) ?? (wanted ? null : bookable[0] ?? null);
  const service = booking ? profile.services.find((s) => s.id === booking.service_id) ?? null : null;
  const back = (
    <Link href={`/coaches/${profile.slug}`} className="text-[13px] font-semibold text-ink-faint hover:text-ink">
      ← {fill(b.back, { name: profile.display_name })}
    </Link>
  );
  if (!booking || !service) {
    return (
      <div className="pt-2 sm:pt-6">
        {back}
        <p className="mt-6 rounded-3xl bg-surface px-6 py-10 text-center font-semibold" data-testid="book-unavailable">{b.notBookable}</p>
      </div>
    );
  }

  const today = zonedDate(new Date(), booking.timezone);
  const from = query.from && DATE.test(query.from) && query.from >= today ? query.from : today;
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const canLook = booking.can_book === "ok" || booking.can_book === "CANNOT_BOOK_SELF";
  const slots = canLook ? await getBookingSlots(booking.service_id, from, 7) : [];
  const price = service.price_unit === "free" ? t.coachProfile.services.free : formatPrice(service.price_cents, service.currency, locale);
  const here = `/coaches/${profile.slug}/book?${new URLSearchParams({ service: booking.service_id, from })}`;
  // a time chosen before signing in, carried through /login (?at=); only ever pre-selected, never booked by itself
  const initialAt = query.at && !Number.isNaN(Date.parse(query.at)) ? new Date(query.at).toISOString() : null;
  const weekHref = (start: string) => `/coaches/${profile.slug}/book?${new URLSearchParams({ service: booking.service_id, from: start })}`;

  return (
    <div className="pt-2 sm:pt-6">
      {/* a service's booking page opened (service_view), and the sign-in wall on it (20261111120000) */}
      {booking.can_book === "CANNOT_BOOK_SELF" ? null : <MarketplaceTracker view="service_view" slug={profile.slug} />}
      {back}
      <header className="mt-2">
        <h1 className="font-display text-[26px] font-extrabold tracking-tight sm:text-[34px]">{b.title}</h1>
        <p className="mt-1 text-[14px] text-ink-soft">{fill(b.with, { name: profile.display_name })}</p>
      </header>
      <div className="mt-5 max-w-3xl">
        <BookingPicker
          key={from}
          serviceId={booking.service_id}
          serviceName={service.name}
          durationMinutes={booking.duration_minutes}
          confirmation={booking.confirmation}
          timezone={booking.timezone}
          price={price}
          coachName={profile.display_name}
          days={days}
          slots={slots}
          canBook={booking.can_book}
          signedIn={Boolean(userId)}
          loginNext={here}
          initialAt={initialAt}
          prevHref={from > today ? weekHref(addDays(from, -7) < today ? today : addDays(from, -7)) : null}
          nextHref={addDays(from, 7) <= addDays(today, booking.max_advance_days) ? weekHref(addDays(from, 7)) : null}
        />
      </div>
    </div>
  );
}
