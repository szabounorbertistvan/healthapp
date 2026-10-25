import type { CodedResultV1, CoachBookingsV1 } from "@healthapp/api/v1";
import { bookingMoves } from "@healthapp/shared";
import { apiJson, v1Route } from "@/lib/api/v1";
import { cancelBooking, markBooking, respondBooking } from "@/app/booking-actions";
import { COACH_BOOKING_SCOPES, formatBookingTime, zoneLabel, type CoachBookingScope } from "@/lib/booking";
import { getCoachBookings } from "@/lib/booking-data";
import { formatPrice } from "@/lib/coach-onboarding";
import { getLocale } from "@/lib/i18n/server";

// The coach's bookings — the web's /bookings: one tab at a time (?tab=), each
// row with the moves bookingMoves() allows, which are exactly the ones the RPCs
// accept. POST makes one move: accept / decline (with a reason) / cancel /
// complete / no_show. Hours and time off stay on /bookings/availability.
export const dynamic = "force-dynamic";

export const GET = v1Route(async (request) => {
  const raw = new URL(request.url).searchParams.get("tab") ?? "";
  const tab: CoachBookingScope = (COACH_BOOKING_SCOPES as string[]).includes(raw) ? (raw as CoachBookingScope) : "upcoming";
  const [rows, locale] = await Promise.all([getCoachBookings(tab), getLocale()]);
  return apiJson<CoachBookingsV1>({
    tab,
    items: rows.map((r) => {
      const when = formatBookingTime(r, locale);
      return {
        id: r.id, status: r.status, person_id: r.person_id, person_name: r.person_name, person_avatar: r.person_avatar,
        service_name: r.service_name, start_at: r.start_at, date: when.date, time: when.time, zone: zoneLabel(r.timezone),
        price: formatPrice(r.price_cents, r.currency, locale), note: r.note, cancellation_reason: r.cancellation_reason,
        cancelled_by_me: r.cancelled_by_me, conversation_id: r.conversation_id, moves: bookingMoves(r, "coach"),
      };
    }),
  });
});

export const POST = v1Route(async (request) => {
  const b = (await request.json().catch(() => null)) as { id?: unknown; move?: unknown; reason?: unknown } | null;
  const id = typeof b?.id === "string" ? b.id : "";
  const reason = typeof b?.reason === "string" && b.reason.trim() ? b.reason.trim() : null;
  const r =
    b?.move === "accept" ? await respondBooking(id, true)
    : b?.move === "decline" ? await respondBooking(id, false, reason)
    : b?.move === "cancel" ? await cancelBooking(id, reason)
    : b?.move === "complete" ? await markBooking(id, "completed")
    : b?.move === "no_show" ? await markBooking(id, "no_show")
    : null;
  if (!r) return apiJson<CodedResultV1>({ ok: false, errorCode: "INVALID_INPUT" }, 400);
  return apiJson<CodedResultV1>({ ok: r.ok, message: r.message, errorCode: r.errorCode });
});
