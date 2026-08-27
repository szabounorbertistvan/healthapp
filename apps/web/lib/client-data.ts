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
  portionMacros,
  sumMacros,
  type Macros,
} from "@healthapp/shared";
import { isDemo, supabaseServer } from "./supabase/server";
import { store } from "./demo-store";
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
  ClientToday,
  ClientWorkoutDay,
  LoggedSetRow,
  MealSlot,
  MessageRow,
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

/** The published program assigned to this client, if any. */
export async function getMyProgramDays(): Promise<ClientWorkoutDay[]> {
  if (isDemo) {
    const clientId = await viewingClientId();
    const program = store().programs.find(
      (p) => p.client_id === clientId && p.status === "published",
    );
    if (!program) return [];
    const cs = clientStore();
    return program.days.map((day) => {
      const session = cs.sessions.find(
        (s) => s.client_id === clientId && s.program_day_id === day.id && s.completed_at === null,
      );
      const logged = session ? setsForSession(session.id) : [];
      return {
        day_id: day.id,
        day_name: day.name,
        program_id: program.id,
        program_name: program.name,
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
        logged,
        session_id: session?.id ?? null,
        completed: false,
      };
    });
  }

  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return [];
  const { data, error } = await supabase
    .from("programs")
    .select(`id, name, intensity_mode,
      program_days(id, name, week_index, day_index,
        program_exercises(id, position, target_sets, target_reps, target_weight_kg, target_rpe, rest_seconds,
          exercise:exercises(name_en, name_ro)))`)
    .eq("client_id", auth.user.id)
    .eq("status", "published")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return [];

  type ExJoin = {
    id: string; position: number; target_sets: number; target_reps: string;
    target_weight_kg: number | null; target_rpe: number | null; rest_seconds: number | null;
    exercise: { name_en: string; name_ro: string | null } | null;
  };
  type DayJoin = { id: string; name: string; day_index: number; program_exercises: ExJoin[] };

  const days = (data.program_days as unknown as DayJoin[]) ?? [];
  return days
    .sort((a, b) => a.day_index - b.day_index)
    .map((day) => ({
      day_id: day.id,
      day_name: day.name,
      program_id: data.id,
      program_name: data.name,
      intensity_mode: data.intensity_mode,
      exercises: day.program_exercises
        .sort((a, b) => a.position - b.position)
        .map((e) => ({
          id: e.id,
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
      logged: [],
      session_id: null,
      completed: false,
    }));
}

export async function getWorkoutDay(dayId: string): Promise<ClientWorkoutDay | null> {
  const days = await getMyProgramDays();
  return days.find((d) => d.day_id === dayId) ?? null;
}

function setsForSession(sessionId: string): LoggedSetRow[] {
  return clientStore()
    .sets.filter((s) => s.session_id === sessionId)
    .sort((a, b) => a.set_index - b.set_index)
    .map((s) => ({
      id: s.id,
      exercise: s.exercise_name,
      set_index: s.set_index,
      weight_kg: s.weight_kg,
      reps: s.reps,
      rpe: s.rpe,
      is_pr: s.is_pr,
      at: s.logged_at,
    }));
}

/** Recent completed sessions, newest first — the training history list. */
export async function getMySessions(limit = 12): Promise<
  { id: string; day_name: string; at: string; sets: number; volume_kg: number; prs: number }[]
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
    .select("id, started_at, completed_at, logged_sets(weight_kg, reps, is_pr)")
    .eq("client_id", auth.user.id)
    .not("completed_at", "is", null)
    .order("completed_at", { ascending: false })
    .limit(limit);
  if (error) return [];
  type SetJoin = { weight_kg: number | null; reps: number | null; is_pr: boolean | null };
  return (data ?? []).map((s) => {
    const sets = (s.logged_sets as unknown as SetJoin[]) ?? [];
    return {
      id: s.id,
      day_name: "Session",
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
  const { data, error } = await supabase
    .from("logged_sets")
    .select("weight_kg, reps, logged_at, is_pr, exercise:exercises(name_en, name_ro), session:logged_sessions!inner(client_id)")
    .eq("session.client_id", auth.user.id)
    .eq("is_pr", true)
    .order("logged_at", { ascending: false });
  if (error) return [];
  type Row = {
    weight_kg: number | null; reps: number | null; logged_at: string;
    exercise: { name_en: string; name_ro: string | null } | null;
  };
  const best = new Map<string, ClientPrRow>();
  for (const row of (data ?? []) as unknown as Row[]) {
    const name = row.exercise?.name_ro ?? row.exercise?.name_en ?? "—";
    const oneRm = estimate(row.weight_kg ?? 0, row.reps ?? 0);
    const current = best.get(name);
    if (!current || oneRm > current.best) best.set(name, { exercise: name, best: oneRm, at: row.logged_at });
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
    const plan = store().plans.find(
      (p) => p.client_id === clientId && p.status === "published",
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
  if (!auth.user) return { day, plan_name: null, target: ZERO, totals: ZERO, entries: [] };
  const [{ data: plan }, { data: logs }] = await Promise.all([
    supabase
      .from("nutrition_plans")
      .select("name, kcal_target, protein_target_g, carbs_target_g, fat_target_g")
      .eq("client_id", auth.user.id)
      .eq("status", "published")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("food_logs")
      .select("id, slot, food_name, grams, kcal, protein_g, carbs_g, fat_g")
      .eq("user_id", auth.user.id)
      .eq("date", day),
  ]);
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
export async function getMyPlanMeals(): Promise<
  { id: string; slot: MealSlot; name: string; foods: { name: string; grams: number; macros: Macros }[] }[]
> {
  if (isDemo) {
    const clientId = await viewingClientId();
    const plan = store().plans.find(
      (p) => p.client_id === clientId && p.status === "published",
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
  const { data } = await supabase
    .from("nutrition_plans")
    .select(`id, planned_meals(id, slot, name, position,
      planned_meal_foods(id, grams, food:foods(name_ro, name_en, kcal_100g, protein_100g, carbs_100g, fat_100g)))`)
    .eq("client_id", auth.user.id)
    .eq("status", "published")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
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
  const { data } = await supabase
    .from("habits")
    .select("id, name, target_per_week, habit_logs(done_on)")
    .eq("client_id", auth.user.id)
    .eq("archived", false);
  type HabitJoin = { id: string; name: string; target_per_week: number; habit_logs: { done_on: string }[] };
  return ((data ?? []) as unknown as HabitJoin[]).map((h) => ({
    id: h.id,
    name: h.name,
    target_per_week: h.target_per_week,
    done_today: h.habit_logs.some((l) => l.done_on === today),
    done_this_week: h.habit_logs.filter((l) => l.done_on >= weekStart).length,
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
  const { data } = await supabase
    .from("measurements")
    .select("id, taken_on, weight_kg, waist_cm")
    .eq("client_id", auth.user.id)
    .order("taken_on", { ascending: false })
    .limit(limit);
  return (data ?? []).reverse();
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
    .eq("client_id", auth.user.id)
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
  const completedSessions = isDemo ? sessionsSince(clientId, weekStart).length : 0;
  const daysLogged = isDemo ? daysLoggedWithin(clientId, 7) : 0;

  const weekKcal: { kcal: number }[] = [];
  if (isDemo) {
    for (let i = 0; i < 7; i++) {
      const totals = totalsOn(clientId, daysAgoIso(i));
      if (totals.kcal > 0) weekKcal.push({ kcal: totals.kcal });
    }
  }

  const habitTicks = habits.reduce((sum, h) => sum + h.done_this_week, 0);
  const habitScheduled = habits.reduce((sum, h) => sum + h.target_per_week, 0);
  const lastActivity = isDemo ? lastActivityAt(clientId) : null;

  const adherence = computeAdherence({
    plannedSessions,
    completedSessions,
    daysLogged,
    macroScore: macroScore(weekKcal, nutrition.target.kcal),
    habitTicks,
    habitScheduled,
    checkinSubmitted: checkIn.submitted,
    inactiveDays: daysSince(lastActivity),
  });

  // Next workout = the first day with nothing logged this week.
  const doneNames = new Set(
    isDemo ? sessionsSince(clientId, weekStart).map((s) => s.day_name) : [],
  );
  const next = days.find((d) => !doneNames.has(d.day_name)) ?? days[0] ?? null;

  return {
    client_id: clientId,
    full_name: isDemo
      ? (store().clients.find((c) => c.client_id === clientId)?.full_name ?? DEMO_CLIENT_NAME)
      : "You",
    adherence,
    streak_days: currentStreak(clientId),
    next_workout: next,
    sessions_done: completedSessions,
    sessions_planned: plannedSessions,
    nutrition,
    habits,
    check_in: checkIn,
    last_activity: lastActivity,
    unread_from_coach: 0,
  };
}

/** Consecutive days ending today (or yesterday) with any logged activity. */
function currentStreak(clientId: string): number {
  if (!isDemo) return 0;
  let streak = 0;
  for (let i = 0; i < 60; i++) {
    const day = daysAgoIso(i);
    const active =
      foodLogsOn(clientId, day).length > 0 ||
      clientStore().habitLogs.some((h) => h.done_on === day) ||
      clientStore().sessions.some((s) => s.client_id === clientId && s.started_at.slice(0, 10) === day);
    if (active) {
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
