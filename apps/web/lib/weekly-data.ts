// Weekly summary reads. One function builds the WeeklyInput for a person and
// a week from the rows that already exist — sessions and sets, food logs,
// measurements, habit logs, the followed program, the published plan — and
// @healthapp/shared does every calculation. The client's Today and the
// coach's client page both come through here, so the two never disagree.
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
import { isDemo, supabaseServer } from "./supabase/server";
import { store } from "./demo-store";
import { viewingClientId } from "./view-mode";
import { clientStore, daysAgoIso, isoDay } from "./demo-client-store";
import { LOGGED_SET_SELECT, streakFrom, toLoggedSetRow, type SetJoin } from "./client-data";
import { loadOf } from "./training-load";
import type { LoggedSetRow } from "./types";

export type WeekChoice = "current" | "previous";

export type WeeklySummary = WeeklyComparison & { choice: WeekChoice };

/** The signed-in client's summary for this week (default) or last week. */
export async function getMyWeeklySummary(choice: WeekChoice = "current"): Promise<WeeklySummary | null> {
  if (isDemo) return summaryFor(await viewingClientId(), choice);
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  return summaryFor(auth.user.id, choice);
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
  const [current, previous] = isDemo
    ? [demoInput(userId, week), demoInput(userId, prev)]
    : await liveInputs(userId, week, prev);
  if (!current || !previous) return null;
  return { ...compareWeeks(weekStats(current), weekStats(previous)), choice };
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

// ---------- demo ----------

function demoInput(userId: string, week: Week): WeeklyInput {
  const cs = clientStore();
  const s = store();
  const hasActiveCoach = s.clients.find((c) => c.client_id === userId)?.status === "active";

  const sessions = cs.sessions
    .filter((x) => x.client_id === userId && x.completed_at !== null)
    .map((x) =>
      toWeeklySession(
        x.started_at,
        x.completed_at,
        cs.sets
          .filter((st) => st.session_id === x.id)
          .map((st) => ({
            id: st.id, program_exercise_id: st.program_exercise_id, exercise: st.exercise_name,
            set_index: st.set_index, weight_kg: st.weight_kg, reps: st.reps, rpe: st.rpe, rir: st.rir,
            notes: st.notes, is_pr: st.is_pr, at: st.logged_at,
          })),
      ),
    );

  const byDay = new Map<string, { kcal: number; protein: number; carbs: number; fat: number }>();
  for (const f of cs.foodLogs) {
    if (f.client_id !== userId) continue;
    const d = byDay.get(f.logged_on) ?? { kcal: 0, protein: 0, carbs: 0, fat: 0 };
    d.kcal += f.macros.kcal; d.protein += f.macros.protein; d.carbs += f.macros.carbs; d.fat += f.macros.fat;
    byDay.set(f.logged_on, d);
  }

  const plan = pickProgram(s.plans.filter((p) => p.client_id === userId && p.status === "published"), hasActiveCoach);
  const program = pickProgram(s.programs.filter((p) => p.client_id === userId && p.status === "published"), hasActiveCoach);

  const habitIds = new Set(cs.habits.filter((h) => h.client_id === userId).map((h) => h.id));
  const active = new Set<string>();
  for (const f of cs.foodLogs) if (f.client_id === userId) active.add(f.logged_on);
  for (const h of cs.habitLogs) if (habitIds.has(h.habit_id)) active.add(h.done_on);
  for (const x of sessions) active.add(x.day);

  return {
    week,
    sessions,
    food_days: [...byDay.entries()].map(([day, m]) => ({ day, ...m })),
    target: plan ? { kcal: plan.kcal_target, protein: plan.protein_target_g, carbs: plan.carbs_target_g, fat: plan.fat_target_g } : null,
    measurements: cs.measurements
      .filter((m) => m.client_id === userId)
      .map((m): WeeklyMeasurement => ({
        day: m.taken_on,
        weight_kg: m.weight_kg,
        circumferences: m.waist_cm !== null ? { waist: m.waist_cm } : {},
      })),
    active_days: [...active],
    planned_workouts: program?.days.length ?? 0,
    streak_days: streakFrom(active),
  };
}

// ---------- live ----------

async function liveInputs(userId: string, week: Week, prev: Week): Promise<[WeeklyInput, WeeklyInput] | [null, null]> {
  const supabase = await supabaseServer();
  // Streak needs 60 days; the two weeks are a filter over the same rows.
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
    supabase.from("trainer_clients").select("coach_id").eq("client_id", userId).eq("status", "active").maybeSingle(),
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

  const hasActiveCoach = coach.data !== null;
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

  const base: Omit<WeeklyInput, "week"> = {
    sessions: weeklySessions,
    food_days: [...byDay.entries()].map(([day, m]) => ({ day, ...m })),
    target: plan
      ? { kcal: Number(plan.kcal_target), protein: Number(plan.protein_target_g), carbs: Number(plan.carbs_target_g), fat: Number(plan.fat_target_g) }
      : null,
    measurements: measured,
    active_days: [...active],
    planned_workouts: program?.program_days?.length ?? 0,
    streak_days: streakFrom(active),
  };
  return [{ ...base, week }, { ...base, week: prev }];
}
