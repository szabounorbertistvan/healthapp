/**
 * Booking shapes and codes for the web app (migration 20261105100000). Pure
 * and client-safe; the reads live in lib/booking-data.ts, the writes in
 * app/booking-actions.ts, the rules shared with SQL in @healthapp/shared.
 */
import type { BookingAccess, BookingConfirmation, BookingStatus } from "@healthapp/shared";

/** Every business code a booking RPC (or a booking table constraint) can raise. */
export const BOOKING_ERRORS = [
  "SERVICE_NOT_FOUND", "NOT_BOOKABLE", "NOT_BOOKABLE_KIND", "COACH_NOT_FOUND", "CANNOT_BOOK_SELF",
  "CLIENTS_ONLY", "COACH_TIMEZONE_INVALID", "INVALID_START", "TOO_SOON", "TOO_FAR", "NOTE_TOO_LONG",
  "BOOKING_RATE", "SLOT_UNAVAILABLE", "BOOKING_NOT_PENDING", "BOOKING_NOT_CANCELLABLE",
  "BOOKING_NOT_MARKABLE", "INVALID_OUTCOME", "INVALID_BOOKING_SETTINGS", "PROFILE_LOCKED", "NOT_FOUND",
  // the availability tables' own constraints
  "OVERLAP", "INVALID_INTERVAL",
] as const;
export type BookingErrorCode = (typeof BOOKING_ERRORS)[number];

/**
 * A Postgres error → its booking code. RPCs raise the code as the message;
 * a direct write to coach_availability / _exceptions surfaces as the
 * constraint's SQLSTATE (23P01 exclusion, 23514 check).
 */
export function bookingErrorCode(error: { message: string; code?: string } | null): BookingErrorCode | null {
  if (!error) return null;
  const named = BOOKING_ERRORS.find((code) => error.message.includes(code));
  if (named) return named;
  if (error.code === "23P01") return "OVERLAP";
  if (error.code === "23514") return "INVALID_INTERVAL";
  return null;
}

export type CoachBookingScope = "upcoming" | "pending" | "confirmed" | "past" | "cancelled" | "completed";
export const COACH_BOOKING_SCOPES: CoachBookingScope[] = ["upcoming", "pending", "confirmed", "past", "completed", "cancelled"];

/** One row of coach_bookings() / my_bookings(); the other party is `person_*`. */
export type BookingRow = {
  id: string;
  status: BookingStatus;
  person_id: string;
  person_name: string;
  person_avatar: string | null;
  /** The coach's public page, on the client's side, while it is public. */
  coach_slug: string | null;
  service_name: string;
  start_at: string;
  end_at: string;
  timezone: string;
  note: string | null;
  cancellation_reason: string | null;
  cancelled_by_me: boolean;
  price_cents: number | null;
  currency: string | null;
  price_unit: string | null;
  conversation_id: string | null;
  created_at: string;
};

/** A bookable service as coach_booking_services() describes it for a public page. */
export type BookableService = {
  service_id: string;
  duration_minutes: number;
  access: BookingAccess;
  confirmation: BookingConfirmation;
  min_notice_minutes: number;
  max_advance_days: number;
  timezone: string;
  /** "ok", or why this reader cannot book it (a BookingErrorCode). */
  can_book: "ok" | BookingErrorCode;
};

export type Slot = { start_at: string; end_at: string };

/** The coach's own schedule, as the availability page edits it. */
export type AvailabilityRow = { id: string; weekday: number; start_time: string; end_time: string; active: boolean };
export type ExceptionRow = {
  id: string; start_date: string; end_date: string; all_day: boolean;
  start_time: string | null; end_time: string | null; title: string | null;
};
export type ServiceBookingRow = {
  id: string; name: string; active: boolean; delivery: string;
  bookable: boolean; booking_duration_minutes: number | null;
  booking_buffer_before_minutes: number; booking_buffer_after_minutes: number;
  booking_min_notice_minutes: number; booking_max_advance_days: number;
  booking_access: BookingAccess; booking_confirmation: BookingConfirmation;
};

/** "10:00 – 11:00" in the booking's own zone, and the date it falls on there. */
export function formatBookingTime(row: { start_at: string; end_at: string; timezone: string }, locale: "en" | "ro") {
  const loc = locale === "ro" ? "ro-RO" : "en-GB";
  const time = new Intl.DateTimeFormat(loc, { timeZone: row.timezone, hour: "2-digit", minute: "2-digit" });
  const date = new Intl.DateTimeFormat(loc, { timeZone: row.timezone, weekday: "short", day: "numeric", month: "short" });
  return {
    date: date.format(new Date(row.start_at)),
    time: `${time.format(new Date(row.start_at))} – ${time.format(new Date(row.end_at))}`,
  };
}

/** "Europe/Bucharest" → "Bucharest", for a short zone label. */
export function zoneLabel(tz: string): string {
  return (tz.split("/").pop() ?? tz).replace(/_/g, " ");
}
