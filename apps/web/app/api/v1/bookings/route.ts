import type { BookingsV1 } from "@healthapp/api/v1";
import { bookingMoves } from "@healthapp/shared";
import { apiJson, v1Route } from "@/lib/api/v1";
import { formatBookingTime, zoneLabel } from "@/lib/booking";
import { getMyBookings } from "@/lib/booking-data";
import { formatPrice } from "@/lib/coach-onboarding";
import { getLocale } from "@/lib/i18n/server";

// The sessions the reader booked — the web's /coaches/bookings: getMyBookings(),
// with the time and price written as that page writes them.
export const dynamic = "force-dynamic";

export const GET = v1Route(async () => {
  const [rows, locale] = await Promise.all([getMyBookings(), getLocale()]);
  return apiJson<BookingsV1>({
    items: rows.map((r) => {
      const when = formatBookingTime(r, locale);
      return {
        id: r.id,
        status: r.status,
        coach_name: r.person_name,
        coach_avatar: r.person_avatar,
        coach_slug: r.coach_slug,
        service_name: r.service_name,
        start_at: r.start_at,
        date: when.date,
        time: when.time,
        zone: zoneLabel(r.timezone),
        price: formatPrice(r.price_cents, r.currency, locale),
        note: r.note,
        cancellation_reason: r.cancellation_reason,
        cancelled_by_me: r.cancelled_by_me,
        conversation_id: r.conversation_id,
        can_cancel: bookingMoves(r, "client").includes("cancel"),
      };
    }),
  });
});
