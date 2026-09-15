// Client training reads: programs, days, sessions, PRs, training load.
import { daysAgoIso, isoDay, mondayOf } from "./dates";
import "server-only";
import { cache } from "react";
import {
  dailyLoad,
  loadTrend,
  pickProgram,
  sumLoad,
  type SelectableProgram,
} from "@healthapp/shared";
import { LOAD_SET_SELECT, loadOf, toLoadSet, type LoadSetJoin } from "./training-load";
import { LOGGED_SET_SELECT, toLoggedSetRow, type SetJoin } from "./logged-sets";
import { liveUser, supabaseServer } from "./supabase/server";
import { sessionKeyFor } from "./stable-id";
import type {
  ClientPrRow,
  ClientProgramGroup,
  ClientWorkoutDay,
  LoggedSetRow,
  SessionSummaryRow,
  TrainingLoadSummary,
  WorkoutHistorySession,
} from "./types";

export { LOGGED_SET_SELECT, toLoggedSetRow, type SetJoin } from "./logged-sets";

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
 *
 * Cached per request: Today, the day page and the set logger all ask.
 */
export const getMyProgramGroups = cache(async (): Promise<ClientProgramGroup[]> => {

  const live = await liveUser();
  if (!live) return [];
  const { supabase, userId } = live;
  // The programs, the coach lookup and today's sessions answer independent
  // questions, so they go out together. The sessions used to wait for the
  // programs (they are addressed by keys built from the day ids), which put a
  // whole round trip behind an otherwise single-wave Today; now the recent
  // sessions come back with everything else and are matched to their keys here.
  const today = isoDay();
  const [{ data: rows, error }, coachId, recentSessions] = await Promise.all([
    supabase
      .from("programs")
      .select(`id, name, intensity_mode, coach_id, updated_at,
        program_days(id, name, week_index, day_index,
          program_exercises(id, exercise_id, position, target_sets, target_reps, target_weight_kg, target_rpe, rest_seconds, circuit,
            exercise:exercises(name_en, name_ro)))`)
      .eq("client_id", userId)
      .eq("status", "published"),
    activeCoachId(userId),
    recentSessionsFor(supabase, userId),
  ]);
  // An empty list is a legitimate answer (a client with no program yet), so a
  // failed query must not be dressed up as one: returning [] here once made a
  // schema drift (app selecting a column production did not have) look to the
  // client like their program had been deleted.
  if (error) {
    throw new Error(`Failed to load programs for client ${userId}: ${error.message}`);
  }
  if (!rows) return [];

  type ExJoin = {
    id: string; exercise_id: string; position: number; target_sets: number; target_reps: string;
    target_weight_kg: number | null; target_rpe: number | null; rest_seconds: number | null; circuit: number | null;
    exercise: { name_en: string; name_ro: string | null } | null;
  };
  type DayJoin = { id: string; name: string; day_index: number; program_exercises: ExJoin[] };
  type ProgramJoin = SelectableProgram & {
    name: string; intensity_mode: "rpe" | "rir" | "simple"; program_days: DayJoin[] | null;
  };

  const programs = rows as unknown as ProgramJoin[];
  const followed = pickProgram(programs, coachId !== null);

  // What is already logged today, addressed by the same deterministic key the
  // writer derives. Without this the set logger restarts its numbering at 1
  // after every reload, and logSet's client_generated_id collides with the set
  // that is already there.
  const allDayIds = programs.flatMap((p) => (p.program_days ?? []).map((d) => d.id));
  const sessions = sessionsForDays(recentSessions, userId, allDayIds, today);

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
              position: e.position,
              circuit: e.circuit ?? null,
            })),
          logged: session?.logged ?? [],
          session_id: session?.id ?? null,
          completed: session?.completed ?? false,
        };
      }),
    };
  });
});

/**
 * The days of the program the client follows — the coach's while a coach is
 * active, otherwise their own. This is what Today and the adherence engine
 * count as planned sessions.
 */
export async function getMyProgramDays(): Promise<ClientWorkoutDay[]> {
  const groups = await getMyProgramGroups();
  return groups.find((g) => g.followed)?.days ?? [];
}

/**
 * The coach currently working with this client, or null when they train alone.
 *
 * Memoized per request: programs, nutrition, the plan header and the empty-account
 * check all need it, and it used to be four identical round trips per render.
 */
export const activeCoachId = cache(async (userId: string): Promise<string | null> => {
  const supabase = await supabaseServer();
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
});

type TodaySession = { id: string; completed: boolean; logged: LoggedSetRow[] };

type SessionJoin = {
  id: string; program_day_id: string | null; client_generated_id: string; completed_at: string | null;
  logged_sets: SetJoin[];
};

/**
 * The client's sessions from the last two days, with their sets — the pool
 * today's per-day sessions are picked from. Two days rather than one because
 * the deterministic key carries the *server's* calendar date while started_at
 * is a timestamp: on a box whose clock is not UTC the two can straddle
 * midnight, and a session must never go missing at 01:00 (the set logger would
 * restart at set 1 and its next write would collide). The key match in
 * sessionsForDays is what decides; this only has to be a superset.
 */
async function recentSessionsFor(
  supabase: Awaited<ReturnType<typeof supabaseServer>>,
  userId: string,
): Promise<SessionJoin[]> {
  const { data } = await supabase
    .from("logged_sessions")
    .select(`id, program_day_id, client_generated_id, completed_at, logged_sets(${LOGGED_SET_SELECT})`)
    .eq("user_id", userId)
    .gte("started_at", `${daysAgoIso(1)}T00:00:00`);
  return (data ?? []) as unknown as SessionJoin[];
}

/**
 * Today's session and its sets, per program day, keyed by program_day_id.
 * Exactly the rows the old `in (client_generated_id …)` query returned: the
 * same deterministic keys, matched in memory against the recent pool.
 */
function sessionsForDays(
  recent: SessionJoin[],
  userId: string,
  dayIds: string[],
  isoDate: string,
): Map<string, TodaySession> {
  const byDay = new Map<string, TodaySession>();
  if (dayIds.length === 0) return byDay;

  const wanted = new Set(dayIds.map((dayId) => sessionKeyFor(userId, dayId, isoDate)));

  for (const session of recent) {
    if (!session.program_day_id || !wanted.has(session.client_generated_id)) continue;
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

function summarizeSession(
  id: string,
  started_at: string,
  completed_at: string | null,
  sets: LoggedSetRow[],
): WorkoutHistorySession {
  return {
    id,
    at: completed_at ?? started_at,
    sets: sets.length,
    volume_kg: Math.round(sets.reduce((sum, x) => sum + x.weight_kg * x.reps, 0)),
    prs: sets.filter((x) => x.is_pr).length,
    load: loadOf(sets, started_at, completed_at),
    exercises: groupByExercise(sets),
  };
}

/**
 * Past completed sessions of one training day, newest first — what opens when
 * the client taps a day on Training. Every set is listed under its exercise so
 * last time's numbers are right there before the next attempt.
 */
export async function getWorkoutDayHistory(dayId: string, limit = 20): Promise<WorkoutHistorySession[]> {
  const live = await liveUser();
  if (!live) return [];
  const { supabase, userId } = live;
  const { data, error } = await supabase
    .from("logged_sessions")
    .select(`id, started_at, completed_at, logged_sets(${LOGGED_SET_SELECT})`)
    .eq("user_id", userId)
    .eq("program_day_id", dayId)
    .not("completed_at", "is", null)
    .order("completed_at", { ascending: false })
    .limit(limit);
  if (error) return [];
  type Row = { id: string; started_at: string; completed_at: string | null; logged_sets: SetJoin[] | null };
  return ((data ?? []) as unknown as Row[]).map((s) =>
    summarizeSession(s.id, s.started_at, s.completed_at, (s.logged_sets ?? []).map(toLoggedSetRow)),
  );
}

/** Recent completed sessions, newest first — the training history list. */
export async function getMySessions(limit = 12): Promise<SessionSummaryRow[]> {
  const live = await liveUser();
  if (!live) return [];
  const { supabase, userId } = live;
  const { data, error } = await supabase
    .from("logged_sessions")
    .select(`id, program_day_id, started_at, completed_at, day:program_days(name), logged_sets(${LOAD_SET_SELECT}, is_pr)`)
    .eq("user_id", userId)
    .not("completed_at", "is", null)
    .order("completed_at", { ascending: false })
    .limit(limit);
  if (error) return [];
  type SetRow = LoadSetJoin & { is_pr: boolean | null };
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
      load: loadOf(sets.map(toLoadSet), s.started_at, s.completed_at),
    };
  });
}

/**
 * Week-over-week training load. Three windows over the same rows: the
 * calendar week so far, the full previous one, and a rolling seven days;
 * plus a 14-day daily series for the chart. Weeks start Monday, like
 * adherence and the check-in.
 */
export async function getMyTrainingLoad(): Promise<TrainingLoadSummary> {
  const days14 = Array.from({ length: 14 }, (_, i) => daysAgoIso(13 - i));
  const entries = await liveLoadEntries();
  const today = isoDay();
  const thisMonday = mondayOf(0);
  const lastMonday = mondayOf(1);
  const this_week = sumLoad(entries, thisMonday, today);
  const last_week = sumLoad(entries, lastMonday, shiftIso(thisMonday, -1));
  return {
    this_week,
    last_week,
    last_7_days: sumLoad(entries, daysAgoIso(6), today),
    trend: loadTrend(this_week, last_week),
    daily: dailyLoad(entries, days14),
  };
}

function shiftIso(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return isoDay(new Date(y, m - 1, d + days));
}

async function liveLoadEntries(): Promise<{ day: string; load: number }[]> {
  const live = await liveUser();
  if (!live) return [];
  const { supabase, userId } = live;
  const { data } = await supabase
    .from("logged_sessions")
    .select(`started_at, completed_at, logged_sets(${LOAD_SET_SELECT})`)
    .eq("user_id", userId)
    .not("completed_at", "is", null)
    .gte("started_at", `${daysAgoIso(20)}T00:00:00`);
  type Row = { started_at: string; completed_at: string | null; logged_sets: LoadSetJoin[] | null };
  return ((data ?? []) as unknown as Row[]).map((s) => ({
    day: s.started_at.slice(0, 10),
    load: loadOf((s.logged_sets ?? []).map(toLoadSet), s.started_at, s.completed_at).score,
  }));
}

export async function getMyPrs(): Promise<ClientPrRow[]> {
  const live = await liveUser();
  if (!live) return [];
  const { supabase, userId } = live;
  // user_id is denormalized onto logged_sets precisely so this needs no join.
  const { data, error } = await supabase
    .from("logged_sets")
    .select("weight_kg, reps, received_at, is_pr, exercise:exercises(name_en, name_ro)")
    .eq("user_id", userId)
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
