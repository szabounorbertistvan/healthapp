import type { CoachAvailabilityV1, CodedResultV1 } from "@healthapp/api/v1";
import { zonedDate } from "@healthapp/shared";
import { apiJson, v1Route } from "@/lib/api/v1";
import {
  addAvailability, addTimeOff, deleteAvailability, deleteTimeOff, setServiceBooking, updateAvailability,
} from "@/app/booking-actions";
import { getMyAvailability } from "@/lib/booking-data";

// The coach's availability — the web's /bookings/availability: GET reads what
// the page shows (getMyAvailability), POST makes one of its writes through the
// same booking actions (op = add | update | delete | addTimeOff | deleteTimeOff
// | service). The actions check every input; this only routes.
export const dynamic = "force-dynamic";

const hhmm = (t: string | null) => (t ?? "").slice(0, 5);

export const GET = v1Route(async () => {
  const data = await getMyAvailability();
  return apiJson<CoachAvailabilityV1>({
    timezone: data.timezone,
    today: zonedDate(new Date(), data.timezone),
    has_profile: data.hasProfile,
    blocks: data.blocks.map((b) => ({ id: b.id, weekday: b.weekday, start: hhmm(b.start_time), end: hhmm(b.end_time), active: b.active })),
    exceptions: data.exceptions.map((e) => ({
      id: e.id, start_date: e.start_date, end_date: e.end_date, all_day: e.all_day,
      start: e.start_time ? hhmm(e.start_time) : null, end: e.end_time ? hhmm(e.end_time) : null, title: e.title,
    })),
    services: data.services.map((s) => ({
      id: s.id, name: s.name, active: s.active, delivery: s.delivery, bookable: s.bookable,
      duration_minutes: s.booking_duration_minutes, buffer_before_minutes: s.booking_buffer_before_minutes,
      buffer_after_minutes: s.booking_buffer_after_minutes, min_notice_minutes: s.booking_min_notice_minutes,
      max_advance_days: s.booking_max_advance_days, access: s.booking_access, confirmation: s.booking_confirmation,
    })),
  });
});

type Body = Record<string, unknown> & { op?: unknown };

export const POST = v1Route(async (request) => {
  const b = (await request.json().catch(() => null)) as Body | null;
  // The actions validate shapes (zod, strict); a wrong type is their INVALID_INPUT.
  const r =
    b?.op === "add" ? await addAvailability({ weekday: b.weekday as number, start: b.start as string, end: b.end as string, active: b.active as boolean })
    : b?.op === "update" ? await updateAvailability({ id: b.id as string, weekday: b.weekday as number, start: b.start as string, end: b.end as string, active: b.active as boolean })
    : b?.op === "delete" ? await deleteAvailability(b.id as string)
    : b?.op === "addTimeOff" ? await addTimeOff({
        startDate: b.startDate as string, endDate: b.endDate as string, allDay: b.allDay as boolean,
        start: (b.start ?? null) as string | null, end: (b.end ?? null) as string | null, title: (b.title ?? null) as string | null,
      })
    : b?.op === "deleteTimeOff" ? await deleteTimeOff(b.id as string)
    : b?.op === "service" ? await setServiceBooking({
        serviceId: b.serviceId as string, bookable: b.bookable as boolean, durationMinutes: (b.durationMinutes ?? null) as number | null,
        bufferBeforeMinutes: b.bufferBeforeMinutes as number, bufferAfterMinutes: b.bufferAfterMinutes as number,
        minNoticeMinutes: b.minNoticeMinutes as number, maxAdvanceDays: b.maxAdvanceDays as number,
        access: b.access as "public" | "clients", confirmation: b.confirmation as "instant" | "approval",
      })
    : null;
  if (!r) return apiJson<CodedResultV1>({ ok: false, errorCode: "INVALID_INPUT" }, 400);
  return apiJson<CodedResultV1>({ ok: r.ok, message: r.message, errorCode: r.errorCode });
});
