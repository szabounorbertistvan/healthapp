// Booking rules (migration 20261105100000), mirrored from SQL so the editor
// can say "this overlaps" before the database refuses it, and the screens
// offer exactly the moves the RPCs accept. The database stays the authority:
// coach_availability's exclusion and check constraints, coach_services'
// booking checks, and respond_booking / cancel_booking / mark_booking.

export const BOOKING_STATUSES = ["pending", "confirmed", "declined", "cancelled", "completed", "no_show"] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/** A booking still holds its time: the two states the exclusion constraints cover. */
export function bookingHoldsSlot(status: BookingStatus): boolean {
  return status === "pending" || status === "confirmed";
}

export const BOOKING_ACCESS = ["public", "clients"] as const;
export type BookingAccess = (typeof BOOKING_ACCESS)[number];
export const BOOKING_CONFIRMATION = ["instant", "approval"] as const;
export type BookingConfirmation = (typeof BOOKING_CONFIRMATION)[number];

/** ISO weekdays, as coach_availability stores them: 1 = Monday … 7 = Sunday. */
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
export type Weekday = (typeof WEEKDAYS)[number];

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$|^24:00$/;

/** "09:30" → 570; "24:00" → 1440 (the end of the day); anything else → null. */
export function timeToMinutes(value: string): number | null {
  const v = value.trim().slice(0, 5);
  if (!HHMM.test(v)) return null;
  const [h, m] = v.split(":").map(Number) as [number, number];
  return h * 60 + m;
}

/** 570 → "09:30". */
export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export type AvailabilityBlock = {
  id?: string;
  weekday: number;
  start: string; // "HH:MM"
  end: string;   // "HH:MM", "24:00" allowed
  active: boolean;
};

export type AvailabilityProblem = "INVALID_TIME" | "END_BEFORE_START" | "INVALID_WEEKDAY" | "OVERLAP";

/**
 * What is wrong with each block, by index (empty when nothing). Mirrors
 * coach_availability_interval (start < end), the weekday check, and the
 * exclusion constraint: two *active* blocks of the same weekday may not
 * overlap; touching (13:00 end, 13:00 start) is fine; inactive blocks never clash.
 */
export function availabilityProblems(blocks: AvailabilityBlock[]): AvailabilityProblem[][] {
  const parsed = blocks.map((b) => ({ s: timeToMinutes(b.start), e: timeToMinutes(b.end) }));
  return blocks.map((b, i) => {
    const out: AvailabilityProblem[] = [];
    const { s, e } = parsed[i]!;
    if (!Number.isInteger(b.weekday) || b.weekday < 1 || b.weekday > 7) out.push("INVALID_WEEKDAY");
    if (s === null || e === null || s === 1440) {
      out.push("INVALID_TIME");
      return out;
    }
    if (s >= e) {
      out.push("END_BEFORE_START");
      return out;
    }
    if (b.active) {
      const clash = blocks.some((o, j) => {
        if (j === i || !o.active || o.weekday !== b.weekday) return false;
        const { s: os, e: oe } = parsed[j]!;
        return os !== null && oe !== null && os < oe && s < oe && os < e;
      });
      if (clash) out.push("OVERLAP");
    }
    return out;
  });
}

export type BookingSettings = {
  bookable: boolean;
  durationMinutes: number | null;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  minNoticeMinutes: number;
  maxAdvanceDays: number;
  access: BookingAccess;
  confirmation: BookingConfirmation;
};

/** The bounds coach_services' checks hold the booking columns to. */
export const BOOKING_LIMITS = {
  durationMin: 10, durationMax: 480,
  bufferMax: 240,
  noticeMax: 43200, // 30 days, in minutes
  advanceMin: 1, advanceMax: 365,
} as const;

export const DEFAULT_BOOKING_SETTINGS: BookingSettings = {
  bookable: false, durationMinutes: 60, bufferBeforeMinutes: 0, bufferAfterMinutes: 0,
  minNoticeMinutes: 720, maxAdvanceDays: 60, access: "public", confirmation: "approval",
};

export type BookingSettingsProblem = "DURATION" | "BUFFER" | "NOTICE" | "ADVANCE" | "DIGITAL";

/** Why coach_set_service_booking() would refuse these settings (empty when it would not). */
export function bookingSettingsProblems(s: BookingSettings, delivery?: string | null): BookingSettingsProblem[] {
  const out: BookingSettingsProblem[] = [];
  const L = BOOKING_LIMITS;
  const int = (n: number | null) => n !== null && Number.isInteger(n);
  if (s.bookable && delivery === "digital") out.push("DIGITAL");
  if ((s.bookable || s.durationMinutes !== null)
      && !(int(s.durationMinutes) && s.durationMinutes! >= L.durationMin && s.durationMinutes! <= L.durationMax)) {
    out.push("DURATION");
  }
  for (const b of [s.bufferBeforeMinutes, s.bufferAfterMinutes]) {
    if (!(int(b) && b >= 0 && b <= L.bufferMax)) { out.push("BUFFER"); break; }
  }
  if (!(int(s.minNoticeMinutes) && s.minNoticeMinutes >= 0 && s.minNoticeMinutes <= L.noticeMax)) out.push("NOTICE");
  if (!(int(s.maxAdvanceDays) && s.maxAdvanceDays >= L.advanceMin && s.maxAdvanceDays <= L.advanceMax)) out.push("ADVANCE");
  return out;
}

export type BookingMove = "accept" | "decline" | "cancel" | "complete" | "no_show";

/**
 * The moves a side may make on a booking now — exactly what the RPCs accept:
 *   respond_booking  coach, pending (accept only before it starts)
 *   cancel_booking   either side, pending or confirmed, before it starts
 *                    (a coach declines a pending one rather than cancelling it)
 *   mark_booking     coach, confirmed, once it has started
 */
export function bookingMoves(
  b: { status: BookingStatus; start_at: string },
  side: "coach" | "client",
  now: Date = new Date(),
): BookingMove[] {
  const started = new Date(b.start_at).getTime() <= now.getTime();
  if (side === "client") {
    return bookingHoldsSlot(b.status) && !started ? ["cancel"] : [];
  }
  if (b.status === "pending") return started ? ["decline"] : ["accept", "decline"];
  if (b.status === "confirmed") return started ? ["complete", "no_show"] : ["cancel"];
  return [];
}

/** The local calendar date ("YYYY-MM-DD") of an instant in a zone — slots are asked for by the coach's dates. */
export function zonedDate(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** "YYYY-MM-DD" + n days, as a plain calendar step (no zone, no DST). */
export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
