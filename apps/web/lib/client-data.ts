// Server-side data access for the client (trainee) surface.
//
// Same contract as lib/data.ts: demo mode (no NEXT_PUBLIC_SUPABASE_URL) reads
// the in-process store, live mode goes through Supabase under RLS. Every
// number a client sees comes from @healthapp/shared, so the coach looking at the
// same week gets the identical figure rather than a second implementation.
import "server-only";
import {
  computeAdherence,
  macroScore,
  pickProgram,
  portionMacros,
  sumMacros,
  type Macros,
  type SelectableProgram,
} from "@healthapp/shared";
import { isDemo, supabaseServer } from "./supabase/server";
import { sessionKeyFor } from "./stable-id";
import { store } from "./demo-store";
import { displayName, getProfile } from "./data";
import { viewingClientId } from "./view-mode";
import { demoConversations, demoMessages } from "./demo";
import {

  DEMO_CLIENT_NAME,
  bestLifts,
  clientStore,
  daysAgoIso,
  daysLoggedWithin,
  daysSince,
  foodLogsOn,
  isoDay,
  lastActivityAt,
  mondayOf,
  sessionsSince,
  totalsOn,
} from "./demo-client-store";
import type {
  ClientCheckInState,
  ClientDayNutrition,
  ClientHabitRow,
  ClientMeasurementRow,
  ClientPrRow,
  ClientProgramGroup,
  ClientToday,
  ClientWorkoutDay,
  LoggedSetRow,
  MealSlot,
  MessageRow,
  WorkoutHistorySession,
} from "./types";

export { isDemo };

const ZERO: Macros = { kcal: 0, protein: 0, carbs: 0, fat: 0 };

/**
 * Which client the current request is acting as. In demo mode there is no auth,
 * so the fixed demo client stands in; live mode uses the signed-in user.
 */
export async function currentClientId(): Promise<string | null> {
  if (isDemo) return viewingClientId();
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

// ---------- training ----------

/** Coach-built programs first, then the client's own; newest first within each. */
function sortPrograms<T extends { coach_id: string | null; updated_at: string }>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => {
    const aOwn = a.coach_id === null ? 1 : 0;
    const bOwn = b.coach_id === null ? 1 : 0;
    if (aOwn !== bOwn) return aOwn - bOwn;
    return b.updated_at.localeCompare(a.updated_at);
  });
}

/**
 * Every published program this client holds — the one their coach assigned and
 * the one they built themselves, when both exist — with today's logged sets
 * attached to each day. Training lists all of them; `followed` marks the single
 * program Today and adherence read (pickProgram: the coach's while a coach is
 * active, otherwise the client's own).
 */
export async function getMyProgramGroups(): Promise<ClientProgramGroup[]> {
  if (isDemo) {
    const clientId = await viewingClientId();
    const s = store();
    // `client.status` is the demo stand-in for trainer_clients.status — see activeCoachId.
    const hasActiveCoach = s.clients.find((c) => c.client_id === clientId)?.status === "active";
    const candidates = s.programs.filter(
      (p) => p.client_id === clientId && p.status === "published",
    );
    const followed = pickProgram(candidates, hasActiveCoach);
    const cs = clientStore();
    return sortPrograms(candidates).map((program) => ({
      program_id: program.id,
      program_name: program.name,
      is_own: program.coach_id === null,
      followed: program.id === followed?.id,
      days: program.days.map((day) => {
        const session = cs.sessions.find(
          (x) => x.client_id === clientId && x.program_day_id === day.id && x.completed_at === null,
        );
        return {
          day_id: day.id,
          day_name: day.name,
          program_id: program.id,
          program_name: program.name,
          is_own: program.coach_id === null,
          intensity_mode: program.intensity_mode,
          exercises: [...day.exercises]
            .sort((a, b) => a.position - b.position)
            .map((e) => ({
              id: e.id,
              exercise: e.exercise_name,
              sets: e.target_sets,
              reps: e.target_reps,
              weight: e.target_weight_kg ? `${e.target_weight_kg} kg` : "—",
              rpe: e.target_rpe?.toString() ?? "—",
              rest: e.rest_seconds ? `${e.rest_seconds}s` : "—",
              weight_kg: e.target_weight_kg,
              rpe_value: e.target_rpe,
              rest_seconds: e.rest_seconds,
            })),
          logged: session ? setsForSession(session.id) : [],
          session_id: session?.id ?? null,
          completed: false,
        };
      }),
    }));
  }

  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return [];
  const { data: rows, error } = await supabase
    .from("programs")
    .select(`id, name, intensity_mode, coach_id, updated_at,
      program_days(id, name, week_index, day_index,
        program_exercises(id, exercise_id, position, target_sets, target_reps, target_weight_kg, target_rpe, rest_seconds,
          exercise:exercises(name_en, name_ro)))`)
    .eq("client_id", auth.user.id)
    .eq("status", "published");
  if (error || !rows) return [];

  type ExJoin = {
    id: string; exercise_id: string; position: number; target_sets: number; target_reps: string;
    target_weight_kg: number | null; target_rpe: number | null; rest_seconds: number | null;
    exercise: { name_en: string; name_ro: string | null } | null;
  };
  type DayJoin = { id: string; name: string; day_index: number; program_exercises: ExJoin[] };
  type ProgramJoin = SelectableProgram & {
    name: string; intensity_mode: "rpe" | "rir" | "simple"; program_days: DayJoin[] | null;
  };

  const programs = rows as unknown as ProgramJoin[];
  const coachId = await activeCoachId(supabase, auth.user.id);
  const followed = pickProgram(programs, coachId !== null);

  // What is already logged today, addressed by the same deterministic key the
  // writer derives. Without this the set logger restarts its numbering at 1
  // after every reload, and logSet's client_generated_id collides with the set
  // that is already there.
  const today = isoDay();
  const allDayIds = programs.flatMap((p) => (p.program_days ?? []).map((d) => d.id));
  const sessions = await sessionsForDays(supabase, auth.user.id, allDayIds, today);

  return sortPrograms(programs).map((program) => {
    const days = [...(program.program_days ?? [])].sort((a, b) => a.day_index - b.day_index);
    return {
      program_id: program.id,
      program_name: program.name,
      is_own: program.coach_id === null,
      followed: program.id === followed?.id,
      days: days.map((day) => {
        const session = sessions.get(day.id);
        return {
          day_id: day.id,
          day_name: day.name,
          program_id: program.id,
          program_name: program.name,
          is_own: program.coach_id === null,
          intensity_mode: program.intensity_mode,
          exercises: [...day.program_exercises]
            .sort((a, b) => a.position - b.position)
            .map((e) => ({
              id: e.id,
              exercise_id: e.exercise_id,
              exercise: e.exercise?.name_ro ?? e.exercise?.name_en ?? "—",
              sets: e.target_sets,
              reps: e.target_reps,
              weight: e.target_weight_kg ? `${e.target_weight_kg} kg` : "—",
              rpe: e.target_rpe?.toString() ?? "—",
              rest: e.rest_seconds ? `${e.rest_seconds}s` : "—",
              weight_kg: e.target_weight_kg,
              rpe_value: e.target_rpe,
              rest_seconds: e.rest_seconds,
            })),
          logged: session?.logged ?? [],
          session_id: session?.id ?? null,
          completed: session?.completed ?? false,
        };
      }),
    };
  });
}

/**
 * The days of the program the client follows — the coach's while a coach is
 * active, otherwise their own. This is what Today and the adherence engine
 * count as planned sessions.
 */
export async function getMyProgramDays(): Promise<ClientWorkoutDay[]> {
  const groups = await getMyProgramGroups();
  return groups.find((g) => g.followed)?.days ?? [];
}

/** The coach currently working with this client, or null when they train alone. */
async function activeCoachId(
  supabase: Awaited<ReturnType<typeof supabaseServer>>,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("trainer_clients")
    .select("coach_id")
    .eq("client_id", userId)
    .eq("status", "active")
    .maybeSingle();
  // A partial unique index guarantees at most one active coach per client, so
  // this is never a legitimate multi-row case — an error here means the query
  // genuinely failed. Throwing (rather than falling back to null) keeps that
  // failure visible instead of silently showing the client their own solo
  // program in place of their coach's.
  if (error) {
    throw new Error(`Failed to look up active coach for client ${userId}: ${error.message}`);
  }
  return (data?.coach_id as string | undefined) ?? null;
}

/** True when the client has no coach, no program and no nutrition plan yet. */
export async function isEmptyAccount(): Promise<boolean> {
  if (isDemo) return false;
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return false;
  const [coach, programs, plans] = await Promise.all([
    activeCoachId(supabase, auth.user.id),
    supabase.from("programs").select("id", { count: "exact", head: true }).eq("client_id", auth.user.id),
    supabase.from("nutrition_plans").select("id", { count: "exact", head: true }).eq("client_id", auth.user.id),
  ]);
  // A failed count is unknown, not zero — treating it as "empty" would bounce a
  // client with a real program to /welcome on a transient database error.
  // activeCoachId() already throws for the same reason; be as loud here.
  const failed = programs.error ?? plans.error;
  if (failed) {
    throw new Error(`Failed to check whether account ${auth.user.id} is empty: ${failed.message}`);
  }
  return coach === null && (programs.count ?? 0) === 0 && (plans.count ?? 0) === 0;
}

type TodaySession = { id: string; completed: boolean; logged: LoggedSetRow[] };

/** The columns a logged set is read with, live. */
const LOGGED_SET_SELECT =
  "id, program_exercise_id, set_index, weight_kg, reps, rpe, rir, notes, is_pr, received_at, exercise:exercises(name_en, name_ro)";

type SetJoin = {
  id: string; program_exercise_id: string | null; set_index: number;
  weight_kg: number | null; reps: number | null; rpe: number | null; rir: number | null;
  notes: string | null; is_pr: boolean | null; received_at: string;
  exercise: { name_en: string; name_ro: string | null } | null;
};

function toLoggedSetRow(s: SetJoin): LoggedSetRow {
  return {
    id: s.id,
    program_exercise_id: s.program_exercise_id,
    exercise: s.exercise?.name_ro ?? s.exercise?.name_en ?? "—",
    set_index: s.set_index,
    weight_kg: s.weight_kg ?? 0,
    reps: s.reps ?? 0,
    rpe: s.rpe,
    rir: s.rir,
    notes: s.notes,
    is_pr: Boolean(s.is_pr),
    at: s.received_at,
  };
}

/** Today's session and its sets, per program day, keyed by program_day_id. */
async function sessionsForDays(
  supabase: Awaited<ReturnType<typeof supabaseServer>>,
  userId: string,
  dayIds: string[],
  isoDate: string,
): Promise<Map<string, TodaySession>> {
  const byDay = new Map<string, TodaySession>();
  if (dayIds.length === 0) return byDay;

  const { data } = await supabase
    .from("logged_sessions")
    .select(`id, program_day_id, completed_at, logged_sets(${LOGGED_SET_SELECT})`)
    .in(
      "client_generated_id",
      dayIds.map((dayId) => sessionKeyFor(userId, dayId, isoDate)),
    );

  type SessionJoin = {
    id: string; program_day_id: string | null; completed_at: string | null;
    logged_sets: SetJoin[];
  };

  for (const session of (data ?? []) as unknown as SessionJoin[]) {
    if (!session.program_day_id) continue;
    byDay.set(session.program_day_id, {
      id: session.id,
      completed: session.completed_at !== null,
      logged: (session.logged_sets ?? [])
        .sort((a, b) => a.set_index - b.set_index)
        .map(toLoggedSetRow),
    });
  }
  return byDay;
}

/** One training day from any of the client's published programs. */
export async function getWorkoutDay(dayId: string): Promise<ClientWorkoutDay | null> {
  const groups = await getMyProgramGroups();
  return groups.flatMap((g) => g.days).find((d) => d.day_id === dayId) ?? null;
}

function setsForSession(sessionId: string): LoggedSetRow[] {
  return clientStore()
    .sets.filter((s) => s.session_id === sessionId)
    .sort((a, b) => a.set_index - b.set_index)
    .map((s) => ({
      id: s.id,
      program_exercise_id: s.program_exercise_id,
      exercise: s.exercise_name,
      set_index: s.set_index,
      weight_kg: s.weight_kg,
      reps: s.reps,
      rpe: s.rpe,
      rir: s.rir,
      notes: s.notes,
      is_pr: s.is_pr,
      at: s.logged_at,
    }));
}

/** Group a session's sets under the exercise they belong to, in the order performed. */
function groupByExercise(sets: LoggedSetRow[]): WorkoutHistorySession["exercises"] {
  const order: string[] = [];
  const byName = new Map<string, WorkoutHistorySession["exercises"][number]["sets"]>();
  const sorted = [...sets].sort((a, b) => a.at.localeCompare(b.at) || a.set_index - b.set_index);
  for (const s of sorted) {
    let bucket = byName.get(s.exercise);
    if (!bucket) {
      bucket = [];
      byName.set(s.exercise, bucket);
      order.push(s.exercise);
    }
    bucket.push({
      id: s.id, set_index: s.set_index, weight_kg: s.weight_kg, reps: s.reps,
      rpe: s.rpe, rir: s.rir, notes: s.notes, is_pr: s.is_pr,
    });
  }
  return order.map((name) => ({ name, sets: byName.get(name) ?? [] }));
}

function summarizeSession(id: string, at: string, sets: LoggedSetRow[]): WorkoutHistorySession {
  return {
    id,
    at,
    sets: sets.length,
    volume_kg: Math.round(sets.reduce((sum, x) => sum + x.weight_kg * x.reps, 0)),
    prs: sets.filter((x) => x.is_pr).length,
    exercises: groupByExercise(sets),
  };
}

/**
 * Past completed sessions of one training day, newest first — what opens when
 * the client taps a day on Training. Every set is listed under its exercise so
 * last time's numbers are right there before the next attempt.
 */
export async function getWorkoutDayHistory(dayId: string, limit = 20): Promise<WorkoutHistorySession[]> {
  if (isDemo) {
    const clientId = await viewingClientId();
    return clientStore()
      .sessions.filter(
        (s) => s.client_id === clientId && s.program_day_id === dayId && s.completed_at !== null,
      )
      .sort((a, b) => (a.started_at < b.started_at ? 1 : -1))
      .slice(0, limit)
      .map((s) => summarizeSession(s.id, s.completed_at ?? s.started_at, setsForSession(s.id)));
  }
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return [];
  const { data, error } = await supabase
    .from("logged_sessions")
    .select(`id, started_at, completed_at, logged_sets(${LOGGED_SET_SELECT})`)
    .eq("user_id", auth.user.id)
    .eq("program_day_id", dayId)
    .not("completed_at", "is", null)
    .order("completed_at", { ascending: false })
    .limit(limit);
  if (error) return [];
  type Row = { id: string; started_at: string; completed_at: string | null; logged_sets: SetJoin[] | null };
  return ((data ?? []) as unknown as Row[]).map((s) =>
    summarizeSession(s.id, s.completed_at ?? s.started_at, (s.logged_sets ?? []).map(toLoggedSetRow)),
  );
}

/** Recent completed sessions, newest first — the training history list. */
export async function getMySessions(limit = 12): Promise<
  { id: string; day_id: string | null; day_name: string; at: string; sets: number; volume_kg: number; prs: number }[]
> {
  if (isDemo) {
    const clientId = await viewingClientId();
    const cs = clientStore();
    return cs.sessions
      .filter((s) => s.client_id === clientId && s.completed_at !== null)
      .sort((a, b) => (a.started_at < b.started_at ? 1 : -1))
      .slice(0, limit)
      .map((s) => {
        const sets = cs.sets.filter((x) => x.session_id === s.id);
        return {
          id: s.id,
          day_id: s.program_day_id,
          day_name: s.day_name,
          at: s.completed_at ?? s.started_at,
          sets: sets.length,
          volume_kg: Math.round(sets.reduce((sum, x) => sum + x.weight_kg * x.reps, 0)),
          prs: sets.filter((x) => x.is_pr).length,
        };
      });
  }
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return [];
  const { data, error } = await supabase
    .from("logged_sessions")
    .select("id, program_day_id, started_at, completed_at, day:program_days(name), logged_sets(weight_kg, reps, is_pr)")
    .eq("user_id", auth.user.id)
    .not("completed_at", "is", null)
    .order("completed_at", { ascending: false })
    .limit(limit);
  if (error) return [];
  type SetRow = { weight_kg: number | null; reps: number | null; is_pr: boolean | null };
  type Row = {
    id: string; program_day_id: string | null; started_at: string; completed_at: string | null;
    day: { name: string } | null; logged_sets: SetRow[] | null;
  };
  return ((data ?? []) as unknown as Row[]).map((s) => {
    const sets = s.logged_sets ?? [];
    return {
      id: s.id,
      day_id: s.program_day_id,
      day_name: s.day?.name ?? "Session",
      at: s.completed_at ?? s.started_at,
      sets: sets.length,
      volume_kg: Math.round(sets.reduce((sum, x) => sum + (x.weight_kg ?? 0) * (x.reps ?? 0), 0)),
      prs: sets.filter((x) => x.is_pr).length,
    };
  });
}

export async function getMyPrs(): Promise<ClientPrRow[]> {
  if (isDemo) return bestLifts(await viewingClientId());
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return [];
  // user_id is denormalized onto logged_sets precisely so this needs no join.
  const { data, error } = await supabase
    .from("logged_sets")
    .select("weight_kg, reps, received_at, is_pr, exercise:exercises(name_en, name_ro)")
    .eq("user_id", auth.user.id)
    .eq("is_pr", true)
    .order("received_at", { ascending: false });
  if (error) return [];
  type Row = {
    weight_kg: number | null; reps: number | null; received_at: string;
    exercise: { name_en: string; name_ro: string | null } | null;
  };
  const best = new Map<string, ClientPrRow>();
  for (const row of (data ?? []) as unknown as Row[]) {
    const name = row.exercise?.name_ro ?? row.exercise?.name_en ?? "—";
    const oneRm = estimate(row.weight_kg ?? 0, row.reps ?? 0);
    const current = best.get(name);
    if (!current || oneRm > current.best) {
      best.set(name, { exercise: name, best: oneRm, at: row.received_at });
    }
  }
  return [...best.values()].sort((a, b) => b.best - a.best);
}

function estimate(weight: number, reps: number): number {
  if (weight <= 0 || reps <= 0) return 0;
  if (reps === 1) return weight;
  return Math.round(weight * (1 + reps / 30) * 10) / 10;
}

// ---------- nutrition ----------

export async function getMyDayNutrition(day = isoDay()): Promise<ClientDayNutrition> {
  if (isDemo) {
    const clientId = await viewingClientId();
    const s = store();
    // Same rule as the live branch: while a coach is active their plan wins,
    // otherwise the client's own targets apply.
    const hasActiveCoach = s.clients.find((c) => c.client_id === clientId)?.status === "active";
    const plan = pickProgram(
      s.plans.filter((p) => p.client_id === clientId && p.status === "published"),
      hasActiveCoach,
    );
    const entries = foodLogsOn(clientId, day).map((f) => ({
      id: f.id,
      slot: f.slot,
      food_name: f.food_name,
      grams: f.grams,
      macros: f.macros,
    }));
    return {
      day,
      plan_name: plan?.name ?? null,
      plan_owner: plan ? (plan.coach_id === null ? "self" : "coach") : null,
      target: plan
        ? {
            kcal: plan.kcal_target,
            protein: plan.protein_target_g,
            carbs: plan.carbs_target_g,
            fat: plan.fat_target_g,
          }
        : ZERO,
      totals: totalsOn(clientId, day),
      entries,
    };
  }

  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { day, plan_name: null, plan_owner: null, target: ZERO, totals: ZERO, entries: [] };
  const [{ data: plans }, { data: logs }] = await Promise.all([
    supabase
      .from("nutrition_plans")
      .select("id, name, kcal_target, protein_target_g, carbs_target_g, fat_target_g, coach_id, updated_at")
      .eq("client_id", auth.user.id)
      .eq("status", "published"),
    supabase
      .from("food_logs")
      .select("id, slot, food_name, grams, kcal, protein_g, carbs_g, fat_g")
      .eq("user_id", auth.user.id)
      .eq("date", day),
  ]);
  const plan = pickProgram(
    (plans ?? []) as unknown as (SelectableProgram & Record<string, unknown>)[],
    (await activeCoachId(supabase, auth.user.id)) !== null,
  ) as { name: string; coach_id: string | null; kcal_target: number; protein_target_g: number;
         carbs_target_g: number; fat_target_g: number } | null;
  type LogRow = {
    id: string; slot: MealSlot; food_name: string; grams: number;
    kcal: number; protein_g: number; carbs_g: number; fat_g: number;
  };
  const entries = ((logs ?? []) as unknown as LogRow[]).map((l) => ({
    id: l.id,
    slot: l.slot,
    food_name: l.food_name,
    grams: l.grams,
    macros: { kcal: l.kcal, protein: l.protein_g, carbs: l.carbs_g, fat: l.fat_g },
  }));
  return {
    day,
    plan_name: plan?.name ?? null,
    plan_owner: plan ? (plan.coach_id === null ? "self" : "coach") : null,
    target: plan
      ? {
          kcal: plan.kcal_target,
          protein: plan.protein_target_g,
          carbs: plan.carbs_target_g,
          fat: plan.fat_target_g,
        }
      : ZERO,
    totals: sumMacros(entries.map((e) => e.macros)),
    entries,
  };
}

/** The published plan as a template — what the coach wants eaten, per meal. */
/**
 * Which days in [from, to] have at least one food log — what the week strip
 * marks as "logged", so a glance shows the gaps in the week.
 */
export async function getMyFoodDays(from: string, to: string): Promise<string[]> {
  if (isDemo) {
    const clientId = await viewingClientId();
    const days = new Set<string>();
    for (const f of clientStore().foodLogs) {
      if (f.client_id === clientId && f.logged_on >= from && f.logged_on <= to) days.add(f.logged_on);
    }
    return [...days].sort();
  }

  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return [];
  const { data } = await supabase
    .from("food_logs")
    .select("date")
    .eq("user_id", auth.user.id)
    .gte("date", from)
    .lte("date", to);
  const days = new Set<string>();
  for (const row of (data ?? []) as { date: string }[]) days.add(row.date);
  return [...days].sort();
}

export async function getMyPlanMeals(): Promise<
  { id: string; slot: MealSlot; name: string; foods: { name: string; grams: number; macros: Macros }[] }[]
> {
  if (isDemo) {
    const clientId = await viewingClientId();
    const s = store();
    const hasActiveCoach = s.clients.find((c) => c.client_id === clientId)?.status === "active";
    const plan = pickProgram(
      s.plans.filter((p) => p.client_id === clientId && p.status === "published"),
      hasActiveCoach,
    );
    if (!plan) return [];
    return [...plan.meals]
      .sort((a, b) => a.position - b.position)
      .map((m) => ({
        id: m.id,
        slot: m.slot,
        name: m.name,
        foods: m.foods.map((f) => ({
          name: f.food_name,
          grams: f.grams,
          macros: portionMacros(f.per_100g, f.grams),
        })),
      }));
  }
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return [];
  const { data: rows } = await supabase
    .from("nutrition_plans")
    .select(`id, coach_id, updated_at, planned_meals(id, slot, name, position,
      planned_meal_foods(id, grams, food:foods(name_ro, name_en, kcal_100g, protein_100g, carbs_100g, fat_100g)))`)
    .eq("client_id", auth.user.id)
    .eq("status", "published");
  const data = pickProgram(
    (rows ?? []) as unknown as (SelectableProgram & Record<string, unknown>)[],
    (await activeCoachId(supabase, auth.user.id)) !== null,
  );
  if (!data) return [];
  type FoodJoin = {
    grams: number;
    food: { name_ro: string | null; name_en: string; kcal_100g: number; protein_100g: number; carbs_100g: number; fat_100g: number } | null;
  };
  type MealJoin = { id: string; slot: MealSlot; name: string; position: number; planned_meal_foods: FoodJoin[] };
  return ((data.planned_meals as unknown as MealJoin[]) ?? [])
    .sort((a, b) => a.position - b.position)
    .map((m) => ({
      id: m.id,
      slot: m.slot,
      name: m.name,
      foods: m.planned_meal_foods.map((f) => ({
        name: f.food?.name_ro ?? f.food?.name_en ?? "—",
        grams: f.grams,
        macros: portionMacros(
          {
            kcal: f.food?.kcal_100g ?? 0,
            protein: f.food?.protein_100g ?? 0,
            carbs: f.food?.carbs_100g ?? 0,
            fat: f.food?.fat_100g ?? 0,
          },
          f.grams,
        ),
      })),
    }));
}

// ---------- habits, measurements, check-ins ----------

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
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return [];
  // The schema has no target_per_week: a habit carries `weekdays int[]`
  // (0=Sun), so how often it is scheduled is how many days it names.
  const { data } = await supabase
    .from("habits")
    .select("id, name, weekdays, habit_logs(date)")
    .eq("user_id", auth.user.id)
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
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return [];
  // Waist is not a column: circumferences is a jsonb bag of {waist, chest, ...}
  // in cm, so the app reads one key out of it rather than a named field.
  const { data } = await supabase
    .from("measurements")
    .select("id, date, weight_kg, circumferences")
    .eq("user_id", auth.user.id)
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
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { week_start: weekStart, submitted: false, last: null };
  const { data } = await supabase
    .from("check_ins")
    .select("week_start, weight_kg, note, coach_reviewed_at")
    .eq("user_id", auth.user.id)
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

// ---------- the Today aggregate ----------

/**
 * One read for the whole Today screen. The adherence figure comes from
 * computeAdherence in @healthapp/shared — the same function the SQL engine
 * mirrors — so the client sees the number their coach sees, with the same
 * plain-language reason attached.
 */
export async function getToday(): Promise<ClientToday | null> {
  const clientId = await currentClientId();
  if (!clientId) return null;

  const [days, nutrition, habits, checkIn] = await Promise.all([
    getMyProgramDays(),
    getMyDayNutrition(),
    getMyHabits(),
    getMyCheckInState(),
  ]);

  const weekStart = mondayOf(0);
  const plannedSessions = days.length;

  // The four inputs adherence turns on. They used to be demo-only, which left
  // every live client reading 0 workouts, 0 food days and 99 inactive days —
  // permanently "at_risk" no matter what they had logged.
  const activity = isDemo ? demoActivity(clientId, weekStart) : await liveActivity(weekStart);

  const habitTicks = habits.reduce((sum, h) => sum + h.done_this_week, 0);
  const habitScheduled = habits.reduce((sum, h) => sum + h.target_per_week, 0);

  const adherence = computeAdherence({
    plannedSessions,
    completedSessions: activity.completedSessions,
    daysLogged: activity.daysLogged,
    macroScore: macroScore(activity.weekKcal, nutrition.target.kcal),
    habitTicks,
    habitScheduled,
    checkinSubmitted: checkIn.submitted,
    inactiveDays: daysSince(activity.lastActivity),
  });

  // Next workout = the first day with nothing logged this week.
  const next =
    days.find((d) => !activity.doneDays.has(d.day_id) && !activity.doneDays.has(d.day_name)) ??
    days[0] ??
    null;

  // What the greeting shows: the username, or the first name for accounts that
  // have not set one yet — never the email.
  const profile = isDemo ? null : await getProfile();
  return {
    client_id: clientId,
    full_name: isDemo
      ? (store().clients.find((c) => c.client_id === clientId)?.full_name ?? DEMO_CLIENT_NAME)
      : displayName(profile),
    adherence,
    streak_days: activity.streak,
    next_workout: next,
    sessions_done: activity.completedSessions,
    sessions_planned: plannedSessions,
    nutrition,
    habits,
    check_in: checkIn,
    last_activity: activity.lastActivity,
    unread_from_coach: 0,
  };
}

/** Everything the adherence engine and the Today header need about the week. */
type Activity = {
  completedSessions: number;
  daysLogged: number;
  weekKcal: { kcal: number }[];
  lastActivity: string | null;
  /** Program days already trained this week — by id live, by name in demo. */
  doneDays: Set<string>;
  streak: number;
};

function demoActivity(clientId: string, weekStart: string): Activity {
  const weekKcal: { kcal: number }[] = [];
  for (let i = 0; i < 7; i++) {
    const totals = totalsOn(clientId, daysAgoIso(i));
    if (totals.kcal > 0) weekKcal.push({ kcal: totals.kcal });
  }
  const activeDays = new Set<string>();
  for (const f of clientStore().foodLogs) if (f.client_id === clientId) activeDays.add(f.logged_on);
  const habitIds = new Set(
    clientStore().habits.filter((h) => h.client_id === clientId).map((h) => h.id),
  );
  for (const h of clientStore().habitLogs) if (habitIds.has(h.habit_id)) activeDays.add(h.done_on);
  for (const s of clientStore().sessions) {
    if (s.client_id === clientId) activeDays.add(s.started_at.slice(0, 10));
  }

  return {
    completedSessions: sessionsSince(clientId, weekStart).length,
    daysLogged: daysLoggedWithin(clientId, 7),
    weekKcal,
    lastActivity: lastActivityAt(clientId),
    doneDays: new Set(sessionsSince(clientId, weekStart).map((s) => s.day_name)),
    streak: streakFrom(activeDays),
  };
}

async function liveActivity(weekStart: string): Promise<Activity> {
  const empty: Activity = {
    completedSessions: 0,
    daysLogged: 0,
    weekKcal: [],
    lastActivity: null,
    doneDays: new Set<string>(),
    streak: 0,
  };
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return empty;

  // 60 days is what the streak walk needs; the week figures are a filter over
  // the same rows rather than four more round trips.
  const since = daysAgoIso(59);
  const [sessions, foods, habitLogs, lastSet] = await Promise.all([
    supabase
      .from("logged_sessions")
      .select("program_day_id, completed_at, started_at")
      .eq("user_id", auth.user.id)
      .gte("started_at", `${since}T00:00:00`),
    supabase
      .from("food_logs")
      .select("date, kcal, received_at")
      .eq("user_id", auth.user.id)
      .gte("date", since),
    supabase
      .from("habit_logs")
      .select("date, received_at")
      .eq("user_id", auth.user.id)
      .gte("date", since),
    supabase
      .from("logged_sets")
      .select("received_at")
      .eq("user_id", auth.user.id)
      .order("received_at", { ascending: false })
      .limit(1),
  ]);

  type SessionRow = { program_day_id: string | null; completed_at: string | null; started_at: string };
  type FoodRow = { date: string; kcal: number; received_at: string };
  type HabitRow = { date: string; received_at: string };

  const sessionRows = (sessions.data ?? []) as unknown as SessionRow[];
  const foodRows = (foods.data ?? []) as unknown as FoodRow[];
  const habitRows = (habitLogs.data ?? []) as unknown as HabitRow[];

  const done = sessionRows.filter(
    (s) => s.completed_at !== null && s.completed_at >= weekStart,
  );

  // kcal per day over the last 7, days with nothing logged left out — the same
  // shape macroScore() gets in demo mode.
  const weekFrom = daysAgoIso(6);
  const kcalByDay = new Map<string, number>();
  for (const f of foodRows) {
    if (f.date < weekFrom) continue;
    kcalByDay.set(f.date, (kcalByDay.get(f.date) ?? 0) + Number(f.kcal ?? 0));
  }

  const activeDays = new Set<string>();
  for (const f of foodRows) activeDays.add(f.date);
  for (const h of habitRows) activeDays.add(h.date);
  for (const s of sessionRows) activeDays.add(s.started_at.slice(0, 10));

  const stamps = [
    ...foodRows.map((f) => f.received_at),
    ...habitRows.map((h) => h.received_at),
    ...((lastSet.data ?? []) as { received_at: string }[]).map((s) => s.received_at),
  ].filter(Boolean);

  return {
    completedSessions: done.length,
    daysLogged: [...kcalByDay.keys()].length,
    weekKcal: [...kcalByDay.values()].filter((kcal) => kcal > 0).map((kcal) => ({ kcal })),
    lastActivity: stamps.length > 0 ? (stamps.sort().at(-1) ?? null) : null,
    doneDays: new Set(done.map((s) => s.program_day_id).filter((id): id is string => id !== null)),
    streak: streakFrom(activeDays),
  };
}

/** Consecutive days ending today (or yesterday) with any logged activity. */
function streakFrom(activeDays: ReadonlySet<string>): number {
  let streak = 0;
  for (let i = 0; i < 60; i++) {
    if (activeDays.has(daysAgoIso(i))) {
      streak++;
    } else if (i > 0) {
      break;
    }
  }
  return streak;
}

// ---------- coach conversation ----------

/**
 * The client side of the coach thread. Demo fixtures are written from the
 * coach point of view, so `mine` is inverted here — in live mode getMessages
 * already resolves it against the signed-in user.
 */
export async function getMyCoachThread(): Promise<
  { id: string; coach_name: string; messages: MessageRow[] } | null
> {
  if (isDemo) {
    const clientId = await viewingClientId();
    const conversation = demoConversations.find((c) => c.client_id === clientId);
    if (!conversation) return null;
    const messages = (demoMessages[conversation.id] ?? []).map((m) => ({ ...m, mine: !m.mine }));
    return { id: conversation.id, coach_name: "Coach Alex", messages };
  }

  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data } = await supabase
    .from("conversations")
    .select("id, coach:users!conversations_coach_id_fkey(full_name), messages(id, body, created_at, sender_id)")
    .eq("client_id", auth.user.id)
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  type Msg = { id: string; body: string; created_at: string; sender_id: string };
  const messages = ((data.messages as unknown as Msg[]) ?? [])
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((m) => ({ id: m.id, body: m.body, at: m.created_at, mine: m.sender_id === auth.user.id }));
  return {
    id: data.id,
    coach_name: (data.coach as unknown as { full_name: string })?.full_name ?? "Your coach",
    messages,
  };
}
