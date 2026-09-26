// Client progress reads: habits, measurements, check-ins.
import { isoDay, mondayOf } from "./dates";
import "server-only";
import { liveUser } from "./supabase/server";
import type { ClientCheckInState, ClientHabitRow, ClientMeasurementRow } from "./types";

export async function getMyHabits(): Promise<ClientHabitRow[]> {
  const today = isoDay();
  const weekStart = mondayOf(0);
  const live = await liveUser();
  if (!live) return [];
  const { supabase, userId } = live;
  // The schema has no target_per_week: a habit carries `weekdays int[]`
  // (0=Sun), so how often it is scheduled is how many days it names.
  const { data } = await supabase
    .from("habits")
    .select("id, name, weekdays, habit_logs(date)")
    .eq("user_id", userId)
    .eq("active", true);
  type HabitJoin = { id: string; name: string; weekdays: number[] | null; habit_logs: { date: string }[] };
  return ((data ?? []) as unknown as HabitJoin[]).map((h) => ({
    id: h.id,
    name: h.name,
    target_per_week: h.weekdays?.length ?? 7,
    done_today: h.habit_logs.some((l) => l.date === today),
    done_this_week: h.habit_logs.filter((l) => l.date >= weekStart).length,
  }));
}

export async function getMyMeasurements(limit = 12): Promise<ClientMeasurementRow[]> {
  const live = await liveUser();
  if (!live) return [];
  const { supabase, userId } = live;
  // Waist is not a column: circumferences is a jsonb bag of {waist, chest, ...}
  // in cm, so the app reads one key out of it rather than a named field.
  const { data } = await supabase
    .from("measurements")
    .select("id, date, weight_kg, circumferences")
    .eq("user_id", userId)
    .order("date", { ascending: false })
    .limit(limit);
  type Row = {
    id: string; date: string; weight_kg: number | null;
    circumferences: Record<string, number> | null;
  };
  return ((data ?? []) as unknown as Row[])
    .map((m) => ({
      id: m.id,
      taken_on: m.date,
      weight_kg: m.weight_kg,
      waist_cm: m.circumferences?.waist ?? null,
      circumferences: Object.fromEntries(
        Object.entries(m.circumferences ?? {}).filter((e): e is [string, number] => typeof e[1] === "number"),
      ),
    }))
    .reverse();
}

export async function getMyCheckInState(): Promise<ClientCheckInState> {
  const weekStart = mondayOf(0);
  const live = await liveUser();
  if (!live) return { week_start: weekStart, submitted: false, last: null };
  const { supabase, userId } = live;
  // The coach's reply to a check-in is written by reviewCheckIn() into
  // coach_feedback, which has no foreign key to check_ins (reference_id is
  // polymorphic), so PostgREST cannot embed it. Fetching the client's newest
  // check-in feedback by client_id instead of by check-in id keeps this to one
  // wave — it runs alongside the check-ins read rather than after it — and the
  // reference_id comparison below discards it unless it belongs to `last`.
  const [{ data }, { data: feedback }] = await Promise.all([
    supabase
      .from("check_ins")
      .select("id, week_start, weight_kg, note, coach_reviewed_at")
      .eq("user_id", userId)
      .order("week_start", { ascending: false })
      .limit(2),
    supabase
      .from("coach_feedback")
      .select("reference_id, body")
      .eq("client_id", userId)
      .eq("reference_type", "check_in")
      .order("created_at", { ascending: false })
      .limit(1),
  ]);
  const rows = data ?? [];
  const last = rows[0] ?? null;
  const newest = feedback?.[0] ?? null;
  return {
    week_start: weekStart,
    submitted: rows.some((r) => r.week_start === weekStart),
    last: last
      ? {
          week_start: last.week_start,
          weight_kg: last.weight_kg,
          note: last.note,
          coach_feedback: newest && newest.reference_id === last.id ? newest.body : null,
          reviewed: last.coach_reviewed_at !== null,
        }
      : null,
  };
}
