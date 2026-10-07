// Booking reads (migration 20261105100000). Every read is an RPC or an
// owner-only table select: the bookings table has no public face, and the
// availability tables are the coach's alone — the public sees slots only.
import "server-only";
import { currentUserId, liveUser, supabasePublic, supabaseServer } from "@/lib/supabase/server";
import type {
  AvailabilityRow, BookableService, BookingRow, CoachBookingScope, ExceptionRow, ServiceBookingRow, Slot,
} from "./booking";

type RpcBooking = Omit<BookingRow, "person_id" | "person_name" | "person_avatar" | "coach_slug"> & {
  client_id?: string; client_name?: string; client_avatar?: string | null;
  coach_id?: string; coach_name?: string; coach_avatar?: string | null; coach_slug?: string | null;
};

function toRow(r: RpcBooking, side: "coach" | "client"): BookingRow {
  return {
    ...r,
    person_id: (side === "coach" ? r.client_id : r.coach_id) ?? "",
    person_name: (side === "coach" ? r.client_name : r.coach_name) ?? "",
    person_avatar: (side === "coach" ? r.client_avatar : r.coach_avatar) ?? null,
    coach_slug: r.coach_slug ?? null,
  };
}

/** The signed-in coach's bookings for one tab (coach_bookings()). */
export async function getCoachBookings(scope: CoachBookingScope): Promise<BookingRow[]> {
  const live = await liveUser();
  if (!live) return [];
  const { data, error } = await live.supabase.rpc("coach_bookings", { p_scope: scope });
  if (error) throw new Error(`coach bookings: ${error.message}`);
  return ((data ?? []) as RpcBooking[]).map((r) => toRow(r, "coach"));
}

/** The signed-in reader's own bookings as a client (my_bookings()). */
export async function getMyBookings(): Promise<BookingRow[]> {
  const live = await liveUser();
  if (!live) return [];
  const { data, error } = await live.supabase.rpc("my_bookings");
  if (error) throw new Error(`my bookings: ${error.message}`);
  return ((data ?? []) as RpcBooking[]).map((r) => toRow(r, "client"));
}

/**
 * A public coach page's bookable services, with whether this reader may book
 * each. Anonymous readers go through the public client, like the profile.
 */
export async function getBookableServices(slug: string): Promise<BookableService[]> {
  const client = (await currentUserId()) ? await supabaseServer() : supabasePublic();
  const { data, error } = await client.rpc("coach_booking_services", { p_slug: slug });
  // The public coach page reads this on every view: a database that does not
  // have the function yet (PGRST202) means "no Book buttons", not a 500.
  if (error?.code === "PGRST202") return [];
  if (error) throw new Error(`bookable services: ${error.message}`);
  return (data ?? []) as BookableService[];
}

/** Free starts for one service over `days` local dates from `from` (coach_booking_slots()). */
export async function getBookingSlots(serviceId: string, from: string, days = 7): Promise<Slot[]> {
  const client = (await currentUserId()) ? await supabaseServer() : supabasePublic();
  const { data, error } = await client.rpc("coach_booking_slots", { p_service: serviceId, p_from: from, p_days: days });
  if (error) throw new Error(`booking slots: ${error.message}`);
  return (data ?? []) as Slot[];
}

/** Everything the availability page edits: the week, time off, the services and the zone they are read in. */
export async function getMyAvailability(): Promise<{
  timezone: string; blocks: AvailabilityRow[]; exceptions: ExceptionRow[]; services: ServiceBookingRow[]; hasProfile: boolean;
}> {
  const live = await liveUser();
  if (!live) return { timezone: "Europe/Bucharest", blocks: [], exceptions: [], services: [], hasProfile: false };
  const { supabase, userId } = live;
  const today = new Date().toISOString().slice(0, 10);
  const [user, blocks, exceptions, profile] = await Promise.all([
    supabase.from("users").select("timezone").eq("id", userId).single(),
    supabase.from("coach_availability").select("id, weekday, start_time, end_time, active")
      .eq("coach_id", userId).order("weekday").order("start_time"),
    supabase.from("coach_availability_exceptions").select("id, start_date, end_date, all_day, start_time, end_time, title")
      .eq("coach_id", userId).gte("end_date", today).order("start_date"),
    supabase.from("coach_profiles").select(`id, coach_services(id, name, active, delivery, sort_order, bookable,
      booking_duration_minutes, booking_buffer_before_minutes, booking_buffer_after_minutes,
      booking_min_notice_minutes, booking_max_advance_days, booking_access, booking_confirmation)`)
      .eq("user_id", userId).maybeSingle(),
  ]);
  for (const r of [user, blocks, exceptions, profile]) if (r.error) throw new Error(`availability: ${r.error.message}`);
  type Svc = ServiceBookingRow & { sort_order: number };
  const services = (((profile.data as { coach_services?: Svc[] } | null)?.coach_services) ?? [])
    .sort((a, b) => a.sort_order - b.sort_order);
  return {
    timezone: (user.data as { timezone: string | null }).timezone ?? "Europe/Bucharest",
    blocks: (blocks.data ?? []) as AvailabilityRow[],
    exceptions: (exceptions.data ?? []) as ExceptionRow[],
    services,
    hasProfile: Boolean(profile.data),
  };
}
