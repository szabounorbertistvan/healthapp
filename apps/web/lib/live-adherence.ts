// This week's adherence, computed live from the rows — the one path both the
// client's Today and the coach's dashboard / roster / client page go through.
//
// Why this exists (BUG-17, QA 2026-09-29): the coach surfaces used to read the
// signal and % from `adherence_snapshots`, which compute_adherence_snapshots()
// writes once a week for the *previous* week, while Today, the load figure and
// the weekly summary were live. A client who trained this morning showed
// "Needs a Restart · 0% · no logs for 13 days" to their coach right above
// "Last activity today". Now both sides fold the same rows with the same
// function into computeAdherence (@healthapp/shared), so they cannot disagree.
import "server-only";
import { computeAdherence, macroScore, pickProgram, type AdherenceResult, type SelectableProgram } from "@healthapp/shared";
import { daysAgoIso, daysSince, mondayOf } from "./dates";
import type { supabaseServer } from "./supabase/server";

type Supabase = Awaited<ReturnType<typeof supabaseServer>>;

/** The raw rows the week is folded from. */
export type ActivityRows = {
  sessions: readonly { program_day_id: string | null; completed_at: string | null; started_at: string }[];
  foods: readonly { date: string; kcal: number | null; received_at: string | null }[];
  habitLogs: readonly { received_at: string | null }[];
  /** received_at of logged sets — the newest is enough. */
  setStamps: readonly (string | null)[];
};

/** Everything the adherence engine and the Today header need about the week. */
export type WeekActivity = {
  completedSessions: number;
  daysLogged: number;
  weekKcal: { kcal: number }[];
  lastActivity: string | null;
  /** Program days already trained this week, by id. */
  doneDays: Set<string>;
};

/** The week's activity from its rows. Pure; the window each caller fetched only has to cover the week. */
export function foldActivity(rows: ActivityRows, weekStart = mondayOf(0)): WeekActivity {
  const done = rows.sessions.filter((s) => s.completed_at !== null && s.completed_at >= weekStart);

  // kcal per day over the last 7, days with nothing logged left out — the
  // shape macroScore() expects.
  const weekFrom = daysAgoIso(6);
  const kcalByDay = new Map<string, number>();
  for (const f of rows.foods) {
    if (f.date < weekFrom) continue;
    kcalByDay.set(f.date, (kcalByDay.get(f.date) ?? 0) + Number(f.kcal ?? 0));
  }

  const stamps = [
    ...rows.foods.map((f) => f.received_at),
    ...rows.habitLogs.map((h) => h.received_at),
    ...rows.setStamps,
  ].filter((s): s is string => Boolean(s));

  return {
    completedSessions: done.length,
    daysLogged: kcalByDay.size,
    weekKcal: [...kcalByDay.values()].filter((kcal) => kcal > 0).map((kcal) => ({ kcal })),
    lastActivity: stamps.length > 0 ? (stamps.sort().at(-1) ?? null) : null,
    doneDays: new Set(done.map((s) => s.program_day_id).filter((id): id is string => id !== null)),
  };
}

/** What the week is measured against. */
export type AdherenceTargets = {
  /** Days of the followed program (pickProgram); 0 for someone without one. */
  plannedSessions: number;
  /** kcal target of the followed nutrition plan; 0 without one. */
  kcalTarget: number;
  habits: readonly { target_per_week: number; done_this_week: number }[];
  checkinSubmitted: boolean;
};

/** The week's adherence — the only place the inputs to computeAdherence are assembled. */
export function adherenceOf(
  activity: WeekActivity,
  targets: AdherenceTargets,
  lastActivity: string | null = activity.lastActivity,
): AdherenceResult {
  return computeAdherence({
    plannedSessions: targets.plannedSessions,
    completedSessions: activity.completedSessions,
    daysLogged: activity.daysLogged,
    macroScore: macroScore(activity.weekKcal, targets.kcalTarget),
    habitTicks: targets.habits.reduce((sum, h) => sum + h.done_this_week, 0),
    habitScheduled: targets.habits.reduce((sum, h) => sum + h.target_per_week, 0),
    checkinSubmitted: targets.checkinSubmitted,
    inactiveDays: daysSince(lastActivity),
  });
}

/** Clients per request: keeps every batched read well under PostgREST's max_rows (1000). */
const CHUNK = 10;

/**
 * This week's adherence for a coach's active clients, batched: seven reads per
 * ten clients, every chunk in the same wave — never one round trip per client.
 * RLS (is_active_coach_of) decides what the coach may read, exactly as for the
 * weekly summary on the client page.
 *
 * The recency reads cover the last eight days only. When nothing falls in that
 * window the client is at risk either way, and `fallbackLast` (coach_dashboard's
 * all-time last activity) supplies the day count for "no logs for N days".
 *
 * A chunk whose reads fail is left out of the map, so the caller keeps the
 * snapshot for those clients rather than showing a made-up zero.
 */
export async function liveAdherenceFor(
  supabase: Supabase,
  clientIds: readonly string[],
  fallbackLast: ReadonlyMap<string, string | null> = new Map(),
): Promise<Map<string, AdherenceResult>> {
  const weekStart = mondayOf(0);
  const from = daysAgoIso(7);
  const chunks: string[][] = [];
  for (let i = 0; i < clientIds.length; i += CHUNK) chunks.push(clientIds.slice(i, i + CHUNK));

  const results = await Promise.all(chunks.map((ids) => chunkAdherence(supabase, ids, weekStart, from, fallbackLast)));
  return new Map(results.flat());
}

async function chunkAdherence(
  supabase: Supabase,
  ids: string[],
  weekStart: string,
  from: string,
  fallbackLast: ReadonlyMap<string, string | null>,
): Promise<[string, AdherenceResult][]> {
  const [sessions, foods, habitLogs, habits, programs, plans, checkIns] = await Promise.all([
    supabase
      .from("logged_sessions")
      .select("user_id, program_day_id, started_at, completed_at, logged_sets(received_at)")
      .in("user_id", ids)
      .gte("started_at", `${daysAgoIso(8)}T00:00:00`),
    supabase.from("food_logs").select("user_id, date, kcal, received_at").in("user_id", ids).gte("date", from),
    supabase.from("habit_logs").select("user_id, received_at").in("user_id", ids).gte("date", from),
    // Same shape as getMyHabits: active habits, this week's ticks.
    supabase
      .from("habits")
      .select("user_id, weekdays, habit_logs(date)")
      .in("user_id", ids)
      .eq("active", true)
      .gte("habit_logs.date", weekStart),
    supabase
      .from("programs")
      .select("client_id, coach_id, updated_at, program_days(id)")
      .in("client_id", ids)
      .eq("status", "published"),
    supabase
      .from("nutrition_plans")
      .select("client_id, coach_id, updated_at, kcal_target")
      .in("client_id", ids)
      .eq("status", "published"),
    supabase.from("check_ins").select("user_id").in("user_id", ids).eq("week_start", weekStart),
  ]);
  const failed = [sessions, foods, habitLogs, habits, programs, plans, checkIns].find((r) => r.error)?.error;
  if (failed) {
    console.error(`live adherence read failed: ${failed.message}`);
    return [];
  }

  type SessionRow = { user_id: string; program_day_id: string | null; started_at: string; completed_at: string | null; logged_sets: { received_at: string | null }[] | null };
  type FoodRow = { user_id: string; date: string; kcal: number | null; received_at: string | null };
  type HabitLogRow = { user_id: string; received_at: string | null };
  type HabitRow = { user_id: string; weekdays: number[] | null; habit_logs: { date: string }[] | null };
  type ProgramRow = SelectableProgram & { client_id: string; program_days: { id: string }[] | null };
  type PlanRow = SelectableProgram & { client_id: string; kcal_target: number | null };

  const group = <T,>(rows: readonly T[], key: (r: T) => string) => {
    const m = new Map<string, T[]>();
    for (const r of rows) {
      const list = m.get(key(r));
      if (list) list.push(r);
      else m.set(key(r), [r]);
    }
    return m;
  };
  const sessionsBy = group((sessions.data ?? []) as unknown as SessionRow[], (r) => r.user_id);
  const foodsBy = group((foods.data ?? []) as unknown as FoodRow[], (r) => r.user_id);
  const habitLogsBy = group((habitLogs.data ?? []) as unknown as HabitLogRow[], (r) => r.user_id);
  const habitsBy = group((habits.data ?? []) as unknown as HabitRow[], (r) => r.user_id);
  const programsBy = group((programs.data ?? []) as unknown as ProgramRow[], (r) => r.client_id);
  const plansBy = group((plans.data ?? []) as unknown as PlanRow[], (r) => r.client_id);
  const checkedIn = new Set(((checkIns.data ?? []) as { user_id: string }[]).map((r) => r.user_id));

  return ids.map((id) => {
    const userSessions = sessionsBy.get(id) ?? [];
    const activity = foldActivity(
      {
        sessions: userSessions,
        foods: foodsBy.get(id) ?? [],
        habitLogs: habitLogsBy.get(id) ?? [],
        setStamps: userSessions.flatMap((s) => (s.logged_sets ?? []).map((x) => x.received_at)),
      },
      weekStart,
    );
    // These are the coach's active clients, so the coach's program and plan
    // win — pickProgram(…, true), the same choice their Today makes.
    const program = pickProgram(programsBy.get(id) ?? [], true);
    const plan = pickProgram(plansBy.get(id) ?? [], true);
    const adherence = adherenceOf(
      activity,
      {
        plannedSessions: program?.program_days?.length ?? 0,
        kcalTarget: Number(plan?.kcal_target ?? 0),
        habits: (habitsBy.get(id) ?? []).map((h) => ({
          target_per_week: h.weekdays?.length ?? 7,
          done_this_week: (h.habit_logs ?? []).filter((l) => l.date >= weekStart).length,
        })),
        checkinSubmitted: checkedIn.has(id),
      },
      activity.lastActivity ?? fallbackLast.get(id) ?? null,
    );
    return [id, adherence] as [string, AdherenceResult];
  });
}
