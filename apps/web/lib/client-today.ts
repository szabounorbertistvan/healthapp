// Today aggregate and the coach thread.
import { daysAgoIso, daysSince, mondayOf } from "./dates";
import "server-only";
import { computeAdherence, macroScore } from "@healthapp/shared";
import { currentActorId } from "./actor";
import { liveUser } from "./supabase/server";
import { displayName, getProfile } from "./data";
import { getWorkoutStreak } from "./streak-data";
import { activeCoachId, getMyProgramDays, getMyTrainingLoad } from "./client-training";
import { getMyDayNutrition } from "./client-nutrition";
import { getMyCheckInState, getMyHabits } from "./client-progress";
import type { ClientToday, MessageRow } from "./types";

/** True when the client has no coach, no program and no nutrition plan yet. */
export async function isEmptyAccount(): Promise<boolean> {
  const live = await liveUser();
  if (!live) return false;
  const { supabase, userId } = live;
  const [coach, programs, plans] = await Promise.all([
    activeCoachId(userId),
    supabase.from("programs").select("id", { count: "exact", head: true }).eq("client_id", userId),
    supabase.from("nutrition_plans").select("id", { count: "exact", head: true }).eq("client_id", userId),
  ]);
  // A failed count is unknown, not zero — treating it as "empty" would bounce a
  // client with a real program to /welcome on a transient database error.
  // activeCoachId() already throws for the same reason; be as loud here.
  const failed = programs.error ?? plans.error;
  if (failed) {
    throw new Error(`Failed to check whether account ${userId} is empty: ${failed.message}`);
  }
  return coach === null && (programs.count ?? 0) === 0 && (plans.count ?? 0) === 0;
}

/**
 * One read for the whole Today screen. The adherence figure comes from
 * computeAdherence in @healthapp/shared — the same function the SQL engine
 * mirrors — so the client sees the number their coach sees, with the same
 * plain-language reason attached.
 */
export async function getToday(): Promise<ClientToday | null> {
  const clientId = await currentActorId();
  if (!clientId) return null;

  const weekStart = mondayOf(0);

  // One wave: activity, streak and profile do not depend on the other reads.
  const [days, nutrition, habits, checkIn, training_load, activity, streak, profile] =
    await Promise.all([
      getMyProgramDays(),
      getMyDayNutrition(),
      getMyHabits(),
      getMyCheckInState(),
      getMyTrainingLoad(),
      liveActivity(weekStart),
      getWorkoutStreak(clientId),
      getProfile(),
    ]);

  const plannedSessions = days.length;

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

  return {
    client_id: clientId,
    full_name: displayName(profile),
    adherence,
    streak_days: streak.current,
    next_workout: next,
    sessions_done: activity.completedSessions,
    sessions_planned: plannedSessions,
    nutrition,
    habits,
    check_in: checkIn,
    last_activity: activity.lastActivity,
    unread_from_coach: 0,
    training_load,
  };
}

/** Everything the adherence engine and the Today header need about the week. */
type Activity = {
  completedSessions: number;
  daysLogged: number;
  weekKcal: { kcal: number }[];
  lastActivity: string | null;
  /** Program days already trained this week, by id. */
  doneDays: Set<string>;
};

async function liveActivity(weekStart: string): Promise<Activity> {
  const empty: Activity = {
    completedSessions: 0,
    daysLogged: 0,
    weekKcal: [],
    lastActivity: null,
    doneDays: new Set<string>(),
  };
  const live = await liveUser();
  if (!live) return empty;
  const { supabase, userId } = live;

  // The inactivity check looks back 60 days; the week figures are a filter
  // over the same rows rather than four more round trips. (The workout streak
  // is its own read — lib/streak-data — so a long streak is never capped here.)
  const since = daysAgoIso(59);
  const [sessions, foods, habitLogs, lastSet] = await Promise.all([
    supabase
      .from("logged_sessions")
      .select("program_day_id, completed_at, started_at")
      .eq("user_id", userId)
      .gte("started_at", `${since}T00:00:00`),
    supabase
      .from("food_logs")
      .select("date, kcal, received_at")
      .eq("user_id", userId)
      .gte("date", since),
    supabase
      .from("habit_logs")
      .select("date, received_at")
      .eq("user_id", userId)
      .gte("date", since),
    supabase
      .from("logged_sets")
      .select("received_at")
      .eq("user_id", userId)
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

  // kcal per day over the last 7, days with nothing logged left out — the
  // shape macroScore() expects.
  const weekFrom = daysAgoIso(6);
  const kcalByDay = new Map<string, number>();
  for (const f of foodRows) {
    if (f.date < weekFrom) continue;
    kcalByDay.set(f.date, (kcalByDay.get(f.date) ?? 0) + Number(f.kcal ?? 0));
  }

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
  };
}

/**
 * The client side of the coach thread. getMessages already resolves `mine`
 * against the signed-in user.
 */
/**
 * Does the signed-in client have an active coach?
 *
 * Distinct from getMyCoachThread(), which answers "is there a conversation
 * row" — a client can be coached before either side has sent a message. The
 * Coach tab needs both: no coach at all is an invitation to join one, a coach
 * with no thread yet is simply an empty conversation.
 */
export async function hasActiveCoach(): Promise<boolean> {
  const userId = await currentActorId();
  if (!userId) return false;
  return (await activeCoachId(userId)) !== null;
}

export async function getMyCoachThread(): Promise<
  { id: string; coach_name: string; messages: MessageRow[] } | null
> {

  const live = await liveUser();
  if (!live) return null;
  const { supabase, userId } = live;
  const { data } = await supabase
    .from("conversations")
    .select("id, coach:users!conversations_coach_id_fkey(full_name), messages(id, body, created_at, sender_id)")
    .eq("client_id", userId)
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  type Msg = { id: string; body: string; created_at: string; sender_id: string };
  const messages = ((data.messages as unknown as Msg[]) ?? [])
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((m) => ({ id: m.id, body: m.body, at: m.created_at, mine: m.sender_id === userId }));
  return {
    id: data.id,
    coach_name: (data.coach as unknown as { full_name: string })?.full_name ?? "Your coach",
    messages,
  };
}
