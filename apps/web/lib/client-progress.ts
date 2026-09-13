// Client progress reads: habits, measurements, check-ins.
import "server-only";
import { isDemo, liveUser } from "./supabase/server";
import { viewingClientId } from "./view-mode";
import { clientStore, isoDay, mondayOf } from "./demo-client-store";
import type { ClientCheckInState, ClientHabitRow, ClientMeasurementRow } from "./types";

export async function getMyHabits(): Promise<ClientHabitRow[]> {
  const today = isoDay();
  const weekStart = mondayOf(0);
  if (isDemo) {
    const clientId = await viewingClientId();
    const cs = clientStore();
    return cs.habits
      .filter((h) => h.client_id === clientId && !h.archived)
      .map((h) => {
        const logs = cs.habitLogs.filter((l) => l.habit_id === h.id);
        return {
          id: h.id,
          name: h.name,
          target_per_week: h.target_per_week,
          done_today: logs.some((l) => l.done_on === today),
          done_this_week: logs.filter((l) => l.done_on >= weekStart).length,
        };
      });
  }
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
  if (isDemo) {
    const clientId = await viewingClientId();
    return clientStore()
      .measurements.filter((m) => m.client_id === clientId)
      .sort((a, b) => (a.taken_on < b.taken_on ? 1 : -1))
      .slice(0, limit)
      .reverse();
  }
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
    }))
    .reverse();
}

export async function getMyCheckInState(): Promise<ClientCheckInState> {
  const weekStart = mondayOf(0);
  if (isDemo) {
    const clientId = await viewingClientId();
    const all = clientStore()
      .checkIns.filter((c) => c.client_id === clientId)
      .sort((a, b) => (a.week_start < b.week_start ? 1 : -1));
    const last = all[0] ?? null;
    return {
      week_start: weekStart,
      submitted: all.some((c) => c.week_start === weekStart),
      last: last
        ? {
            week_start: last.week_start,
            weight_kg: last.weight_kg,
            note: last.note,
            coach_feedback: last.coach_feedback,
            reviewed: last.coach_reviewed_at !== null,
          }
        : null,
    };
  }
  const live = await liveUser();
  if (!live) return { week_start: weekStart, submitted: false, last: null };
  const { supabase, userId } = live;
  const { data } = await supabase
    .from("check_ins")
    .select("week_start, weight_kg, note, coach_reviewed_at")
    .eq("user_id", userId)
    .order("week_start", { ascending: false })
    .limit(2);
  const rows = data ?? [];
  const last = rows[0] ?? null;
  return {
    week_start: weekStart,
    submitted: rows.some((r) => r.week_start === weekStart),
    last: last
      ? {
          week_start: last.week_start,
          weight_kg: last.weight_kg,
          note: last.note,
          coach_feedback: null,
          reviewed: last.coach_reviewed_at !== null,
        }
      : null,
  };
}
