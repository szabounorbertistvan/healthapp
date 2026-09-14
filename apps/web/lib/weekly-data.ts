// Weekly summary reads. One function builds the WeeklyInput for a person and
// a week from the rows that already exist — sessions and sets, food logs,
// measurements, habit logs, the followed program, the published plan — and
// @healthapp/shared does every calculation. The client's Today and the
// coach's client page both come through here, so the two never disagree.
import { daysAgoIso, isoDay } from "./dates";
import "server-only";
import {
  compareWeeks,
  pickProgram,
  previousWeek,
  weekOf,
  weekStats,
  type SelectableProgram,
  type Week,
  type WeeklyComparison,
  type WeeklyInput,
  type WeeklyMeasurement,
  type WeeklySession,
} from "@healthapp/shared";
import { liveUser, supabaseServer } from "./supabase/server";
import { LOGGED_SET_SELECT, toLoggedSetRow, type SetJoin } from "./logged-sets";
import { activeCoachId } from "./client-training";
import { getWorkoutStreak } from "./streak-data";
import { loadOf } from "./training-load";
import type { LoggedSetRow } from "./types";

export type WeekChoice = "current" | "previous";

export type WeeklySummary = WeeklyComparison & { choice: WeekChoice };

/** The signed-in client's summary for this week (default) or last week. */
export async function getMyWeeklySummary(choice: WeekChoice = "current"): Promise<WeeklySummary | null> {
  const live = await liveUser();
  if (!live) return null;
  return summaryFor(live.userId, choice);
}

/**
 * A client's summary as their coach sees it. Live, every query below is
 * filtered by user_id and RLS decides whether the coach may read those rows
 * (is_active_coach_of); a coach with no relationship gets an empty week.
 */
export async function getClientWeeklySummary(clientId: string, choice: WeekChoice = "current"): Promise<WeeklySummary | null> {
  return summaryFor(clientId, choice);
}

async function summaryFor(userId: string, choice: WeekChoice): Promise<WeeklySummary | null> {
  const thisWeek = weekOf(isoDay());
  const week = choice === "current" ? thisWeek : previousWeek(thisWeek);
  const prev = previousWeek(week);
  // The workout streak (lib/streak-data): the same number Today and the streak
  // page show. It only decorates the input, so it does not gate the row reads:
  // the streak RPC (the slowest single call on Today) and the seven row queries
  // go out together instead of one waiting for the other.
  const [streak, [current, previous]] = await Promise.all([
    getWorkoutStreak(userId),
    liveInputs(userId, week, prev),
  ]);
  if (!current || !previous) return null;
  const streak_days = streak.current;
  return {
    ...compareWeeks(weekStats({ ...current, streak_days }), weekStats({ ...previous, streak_days })),
    choice,
  };
}

/** A session row → the shape weekStats folds over. */
function toWeeklySession(started_at: string, completed_at: string | null, sets: LoggedSetRow[]): WeeklySession {
  const load = loadOf(sets, started_at, completed_at);
  return {
    day: started_at.slice(0, 10),
    duration_min: load.duration_min,
    load: load.score,
    volume_kg: load.volume_kg,
    sets: sets.filter((s) => s.reps > 0).length,
    exercises: [...new Set(sets.map((s) => s.exercise))],
    prs: sets.filter((s) => s.is_pr).map((s) => ({ exercise: s.exercise, weight_kg: s.weight_kg, reps: s.reps })),
  };
}

// ---------- live ----------

/** A WeeklyInput before the streak is attached — everything that comes from rows. */
type WeeklyRows = Omit<WeeklyInput, "streak_days">;

async function liveInputs(userId: string, week: Week, prev: Week): Promise<[WeeklyRows, WeeklyRows] | [null, null]> {
  const supabase = await supabaseServer();
  // The two weeks, plus a little history for the load trend.
  const since = daysAgoIso(59);
  const from = prev.start < since ? prev.start : since;
  const [sessions, foods, habitLogs, measurements, plans, programs, coach] = await Promise.all([
    supabase
      .from("logged_sessions")
      .select(`started_at, completed_at, logged_sets(${LOGGED_SET_SELECT})`)
      .eq("user_id", userId)
      .not("completed_at", "is", null)
      .gte("started_at", `${from}T00:00:00`),
    supabase.from("food_logs").select("date, kcal, protein_g, carbs_g, fat_g").eq("user_id", userId).gte("date", from),
    supabase.from("habit_logs").select("date").eq("user_id", userId).gte("date", from),
    supabase.from("measurements").select("date, weight_kg, circumferences").eq("user_id", userId).gte("date", prev.start),
    supabase
      .from("nutrition_plans")
      .select("id, coach_id, updated_at, kcal_target, protein_target_g, carbs_target_g, fat_target_g")
      .eq("client_id", userId)
      .eq("status", "published"),
    supabase
      .from("programs")
      .select("id, coach_id, updated_at, program_days(id)")
      .eq("client_id", userId)
      .eq("status", "published"),
    // Request-cached: Today has already asked this for the same client.
    activeCoachId(userId),
  ]);
  if (sessions.error) return [null, null];

  type SessionRow = { started_at: string; completed_at: string | null; logged_sets: SetJoin[] | null };
  type FoodRow = { date: string; kcal: number | null; protein_g: number | null; carbs_g: number | null; fat_g: number | null };
  type MeasureRow = { date: string; weight_kg: number | null; circumferences: Record<string, number> | null };
  type PlanRow = SelectableProgram & { kcal_target: number; protein_target_g: number; carbs_target_g: number; fat_target_g: number };
  type ProgramRow = SelectableProgram & { program_days: { id: string }[] | null };

  const weeklySessions = ((sessions.data ?? []) as unknown as SessionRow[]).map((s) =>
    toWeeklySession(s.started_at, s.completed_at, (s.logged_sets ?? []).map(toLoggedSetRow)),
  );

  const byDay = new Map<string, { kcal: number; protein: number; carbs: number; fat: number }>();
  for (const f of (foods.data ?? []) as FoodRow[]) {
    const d = byDay.get(f.date) ?? { kcal: 0, protein: 0, carbs: 0, fat: 0 };
    d.kcal += Number(f.kcal ?? 0); d.protein += Number(f.protein_g ?? 0);
    d.carbs += Number(f.carbs_g ?? 0); d.fat += Number(f.fat_g ?? 0);
    byDay.set(f.date, d);
  }

  const hasActiveCoach = coach !== null;
  const plan = pickProgram((plans.data ?? []) as unknown as PlanRow[], hasActiveCoach);
  const program = pickProgram((programs.data ?? []) as unknown as ProgramRow[], hasActiveCoach);

  const active = new Set<string>();
  for (const f of byDay.keys()) active.add(f);
  for (const h of (habitLogs.data ?? []) as { date: string }[]) active.add(h.date);
  for (const s of weeklySessions) active.add(s.day);

  const measured: WeeklyMeasurement[] = ((measurements.data ?? []) as MeasureRow[]).map((m) => ({
    day: m.date,
    weight_kg: m.weight_kg === null ? null : Number(m.weight_kg),
    circumferences: Object.fromEntries(
      Object.entries(m.circumferences ?? {}).filter((e): e is [string, number] => typeof e[1] === "number"),
    ),
  }));

  const base: Omit<WeeklyRows, "week"> = {
    sessions: weeklySessions,
    food_days: [...byDay.entries()].map(([day, m]) => ({ day, ...m })),
    target: plan
      ? { kcal: Number(plan.kcal_target), protein: Number(plan.protein_target_g), carbs: Number(plan.carbs_target_g), fat: Number(plan.fat_target_g) }
      : null,
    measurements: measured,
    active_days: [...active],
    planned_workouts: program?.program_days?.length ?? 0,
  };
  return [{ ...base, week }, { ...base, week: prev }];
}
