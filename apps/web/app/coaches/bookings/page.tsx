import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { APP_NAME } from "@/lib/brand";
import { getI18n } from "@/lib/i18n/server";
import { currentUserId } from "@/lib/supabase/server";
import { getMyBookings } from "@/lib/booking-data";
import { MyBookingList } from "@/components/bookings";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: `${t.coachProfile.bookings.mine.title} | ${APP_NAME}`, robots: { index: false, follow: false } };
}

/**
 * /coaches/bookings — the sessions the reader booked (20261105100000):
 * upcoming, waiting for the coach, past, cancelled. Next to My requests and
 * Saved; "bookings" is a reserved coach slug, so the static route wins.
 * Middleware lets /coaches/* through without a session, so the page sends
 * anonymous visitors to sign in itself.
 */
export default async function MyBookingsPage() {
  if (!(await currentUserId())) redirect(`/login?${new URLSearchParams({ next: "/coaches/bookings" })}`);
  const [{ t }, rows] = await Promise.all([getI18n(), getMyBookings()]);
  const m = t.coachProfile.bookings.mine;
  return (
    <div className="pt-2 sm:pt-6">
      <Link href="/coaches" className="text-[13px] font-semibold text-ink-faint hover:text-ink">← {t.coachProfile.discovery.backToDiscover}</Link>
      <header className="mt-2">
        <h1 className="font-display text-[26px] font-extrabold tracking-tight sm:text-[34px]">{m.title}</h1>
        <p className="mt-1 text-[14px] text-ink-soft">{m.hint}</p>
      </header>
      <div className="mt-5 max-w-3xl">
        <MyBookingList rows={rows} />
      </div>
    </div>
  );
}
