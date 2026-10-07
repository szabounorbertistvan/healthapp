"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { availabilityProblems, bookingSettingsProblems } from "@healthapp/shared";
import { liveUser } from "@/lib/supabase/server";
import { mutated } from "@/lib/supabase/mutate";
import { notSignedIn } from "@/lib/action-result";
import { id, parseInput } from "@/lib/validate";
import { bookingErrorCode } from "@/lib/booking";
import type { ActionResult } from "./actions";

// Booking writes (migration 20261105100000). The coach's week and time off
// are plain table writes under owner-only RLS — the exclusion and check
// constraints refuse overlaps and backwards intervals (OVERLAP /
// INVALID_INTERVAL). Everything that touches a booking or a service's
// settings is an RPC that re-checks every rule; nothing here trusts a slot
// the browser picked.

function failure(error: { message: string; code?: string }): ActionResult {
  const code = bookingErrorCode(error);
  if (code) return { ok: false, errorCode: code, message: code };
  console.error("booking write failed:", error.message);
  return { ok: false, message: error.message };
}

function touched() {
  revalidatePath("/bookings", "layout");
  revalidatePath("/coaches/bookings");
}

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// ---------- the weekly schedule ----------

const blockInput = z.object({ weekday: z.number().int().min(1).max(7), start: time, end: time, active: z.boolean() }).strict();

export async function addAvailability(input: z.input<typeof blockInput>): Promise<ActionResult> {
  const parsed = await parseInput(blockInput, input);
  if (!parsed.ok) return parsed.result;
  const b = parsed.data;
  if (availabilityProblems([b])[0]!.length) return { ok: false, errorCode: "INVALID_INTERVAL", message: "INVALID_INTERVAL" };
  const live = await liveUser();
  if (!live) return notSignedIn;
  const { error } = await live.supabase.from("coach_availability")
    .insert({ coach_id: live.userId, weekday: b.weekday, start_time: b.start, end_time: b.end, active: b.active });
  if (error) return failure(error);
  touched();
  return { ok: true };
}

export async function updateAvailability(input: z.input<typeof blockInput> & { id: string }): Promise<ActionResult> {
  const parsed = await parseInput(blockInput.extend({ id }), input);
  if (!parsed.ok) return parsed.result;
  const b = parsed.data;
  if (availabilityProblems([b])[0]!.length) return { ok: false, errorCode: "INVALID_INTERVAL", message: "INVALID_INTERVAL" };
  const live = await liveUser();
  if (!live) return notSignedIn;
  const result = await live.supabase.from("coach_availability")
    .update({ weekday: b.weekday, start_time: b.start, end_time: b.end, active: b.active }, { count: "exact" })
    .eq("id", b.id).eq("coach_id", live.userId);
  if (result.error) return failure(result.error);
  const guard = await mutated(result);
  if (guard) return guard;
  touched();
  return { ok: true };
}

export async function deleteAvailability(blockId: string): Promise<ActionResult> {
  const parsed = await parseInput(id, blockId);
  if (!parsed.ok) return parsed.result;
  const live = await liveUser();
  if (!live) return notSignedIn;
  const guard = await mutated(await live.supabase.from("coach_availability")
    .delete({ count: "exact" }).eq("id", parsed.data).eq("coach_id", live.userId));
  if (guard) return guard;
  touched();
  return { ok: true };
}

// ---------- time off ----------

const exceptionInput = z.object({
  startDate: date, endDate: date, allDay: z.boolean(),
  start: time.nullable(), end: time.nullable(),
  title: z.string().max(100).nullable(),
}).strict();

export async function addTimeOff(input: z.input<typeof exceptionInput>): Promise<ActionResult> {
  const parsed = await parseInput(exceptionInput, input);
  if (!parsed.ok) return parsed.result;
  const e = parsed.data;
  const live = await liveUser();
  if (!live) return notSignedIn;
  const { error } = await live.supabase.from("coach_availability_exceptions").insert({
    coach_id: live.userId,
    start_date: e.startDate,
    // a timed block is one day (coach_exceptions_timed)
    end_date: e.allDay ? e.endDate : e.startDate,
    all_day: e.allDay,
    start_time: e.allDay ? null : e.start,
    end_time: e.allDay ? null : e.end,
    title: e.title?.trim() || null,
  });
  if (error) return failure(error);
  touched();
  return { ok: true };
}

export async function deleteTimeOff(exceptionId: string): Promise<ActionResult> {
  const parsed = await parseInput(id, exceptionId);
  if (!parsed.ok) return parsed.result;
  const live = await liveUser();
  if (!live) return notSignedIn;
  const guard = await mutated(await live.supabase.from("coach_availability_exceptions")
    .delete({ count: "exact" }).eq("id", parsed.data).eq("coach_id", live.userId));
  if (guard) return guard;
  touched();
  return { ok: true };
}

// ---------- a service's booking settings ----------

const settingsInput = z.object({
  serviceId: id,
  bookable: z.boolean(),
  durationMinutes: z.number().int().nullable(),
  bufferBeforeMinutes: z.number().int(),
  bufferAfterMinutes: z.number().int(),
  minNoticeMinutes: z.number().int(),
  maxAdvanceDays: z.number().int(),
  access: z.enum(["public", "clients"]),
  confirmation: z.enum(["instant", "approval"]),
}).strict();

export async function setServiceBooking(input: z.input<typeof settingsInput>): Promise<ActionResult> {
  const parsed = await parseInput(settingsInput, input);
  if (!parsed.ok) return parsed.result;
  const s = parsed.data;
  if (bookingSettingsProblems(s).length) return { ok: false, errorCode: "INVALID_BOOKING_SETTINGS", message: "INVALID_BOOKING_SETTINGS" };
  const live = await liveUser();
  if (!live) return notSignedIn;
  const { error } = await live.supabase.rpc("coach_set_service_booking", {
    p_service: s.serviceId,
    p_bookable: s.bookable,
    p_duration: s.durationMinutes,
    p_buffer_before: s.bufferBeforeMinutes,
    p_buffer_after: s.bufferAfterMinutes,
    p_min_notice: s.minNoticeMinutes,
    p_max_advance: s.maxAdvanceDays,
    p_access: s.access,
    p_confirmation: s.confirmation,
  });
  if (error) return failure(error);
  touched();
  revalidatePath("/coaches", "layout");
  return { ok: true };
}

// ---------- bookings ----------

/**
 * Book one start of one service. book_service() re-runs the slot computation
 * for that start and refuses anything it would not offer right now.
 */
export async function bookService(input: { serviceId: string; startAt: string; note?: string | null }): Promise<ActionResult & { bookingId?: string }> {
  const parsed = await parseInput(z.object({
    serviceId: id, startAt: z.iso.datetime({ offset: true }), note: z.string().max(1000).nullable().optional(),
  }).strict(), input);
  if (!parsed.ok) return parsed.result;
  const live = await liveUser();
  if (!live) return notSignedIn;
  const { data, error } = await live.supabase.rpc("book_service", {
    p_service: parsed.data.serviceId, p_start_at: parsed.data.startAt, p_note: parsed.data.note?.trim() || null,
  });
  if (error) return failure(error);
  touched();
  return { ok: true, bookingId: data as string };
}

/** The coach confirms or declines a pending booking. */
export async function respondBooking(bookingId: string, accept: boolean, reason?: string | null): Promise<ActionResult> {
  const parsed = await parseInput(id, bookingId);
  if (!parsed.ok) return parsed.result;
  const live = await liveUser();
  if (!live) return notSignedIn;
  const { error } = await live.supabase.rpc("respond_booking", {
    p_booking: parsed.data, p_accept: accept, p_reason: reason?.slice(0, 500) ?? null,
  });
  if (error) return failure(error);
  touched();
  return { ok: true };
}

/** Either side cancels a booking that has not started. */
export async function cancelBooking(bookingId: string, reason?: string | null): Promise<ActionResult> {
  const parsed = await parseInput(id, bookingId);
  if (!parsed.ok) return parsed.result;
  const live = await liveUser();
  if (!live) return notSignedIn;
  const { error } = await live.supabase.rpc("cancel_booking", { p_booking: parsed.data, p_reason: reason?.slice(0, 500) ?? null });
  if (error) return failure(error);
  touched();
  return { ok: true };
}

/** After a confirmed session started, the coach records completed or no-show. */
export async function markBooking(bookingId: string, outcome: "completed" | "no_show"): Promise<ActionResult> {
  const parsed = await parseInput(z.object({ id, outcome: z.enum(["completed", "no_show"]) }).strict(), { id: bookingId, outcome });
  if (!parsed.ok) return parsed.result;
  const live = await liveUser();
  if (!live) return notSignedIn;
  const { error } = await live.supabase.rpc("mark_booking", { p_booking: parsed.data.id, p_outcome: parsed.data.outcome });
  if (error) return failure(error);
  touched();
  return { ok: true };
}
