// Mutable demo backend for the client (trainee) app.
//
// Mirrors the Postgres tables the client surface writes to — logged_sessions →
// logged_sets, food_logs, habits → habit_logs, measurements, check_ins — so the
// Supabase branch of lib/client-data.ts stays a straight swap rather than a
// rewrite, the same trade demo-store.ts makes for the coach side.
//
// Kept separate from demo-store.ts on purpose: that store is the coach roster
// and builders, this one is a single client's activity. They share ids (the demo
// client is Maria D., "d1") but nothing else.
//
// Lives in the server process: lost on dev-server restart.
import { estimated1RM, portionMacros, sumMacros, type Macros } from "@healthapp/shared";

/** The demo client. Matches demoDashboard[0] so coach and client agree on who this is. */
export const DEMO_CLIENT_ID = "d1";
export const DEMO_CLIENT_NAME = "Maria D.";

export type MealSlot = "breakfast" | "lunch" | "dinner" | "snack";

export type StoredLoggedSet = {
  id: string;
  session_id: string;
  /** program_exercises.id — a day may prescribe the same lift more than once. */
  program_exercise_id: string | null;
  exercise_name: string;
  set_index: number;
  weight_kg: number;
  reps: number;
  rpe: number | null;
  is_pr: boolean;
  logged_at: string;
};

export type StoredSession = {
  id: string;
  client_id: string;
  program_day_id: string | null;
  day_name: string;
  started_at: string;
  completed_at: string | null;
};

export type StoredFoodLog = {
  id: string;
  client_id: string;
  logged_on: string;
  slot: MealSlot;
  food_name: string;
  grams: number;
  /** Snapshot at log time — external food data may change, history must not. */
  macros: Macros;
  /** Kept so an edited portion can be re-costed without re-fetching the food. */
  per_100g: Macros;
  logged_at: string;
};

export type StoredHabit = {
  id: string;
  client_id: string;
  name: string;
  /** Times per week this habit is scheduled. */
  target_per_week: number;
  archived: boolean;
};

export type StoredHabitLog = { id: string; habit_id: string; done_on: string };

export type StoredMeasurement = {
  id: string;
  client_id: string;
  taken_on: string;
  weight_kg: number | null;
  waist_cm: number | null;
};

export type StoredClientCheckIn = {
  id: string;
  client_id: string;
  week_start: string;
  weight_kg: number | null;
  sleep: number | null;
  energy: number | null;
  stress: number | null;
  hunger: number | null;
  recovery: number | null;
  note: string | null;
  submitted_at: string;
  coach_reviewed_at: string | null;
  coach_feedback: string | null;
};

type ClientStore = {
  sessions: StoredSession[];
  sets: StoredLoggedSet[];
  foodLogs: StoredFoodLog[];
  habits: StoredHabit[];
  habitLogs: StoredHabitLog[];
  measurements: StoredMeasurement[];
  checkIns: StoredClientCheckIn[];
};

// Bump whenever ClientStore changes shape — a store carried across a hot reload
// that is missing a new field would crash every reader.
const STORE_VERSION = 3;

const globalRef = globalThis as unknown as {
  __healthappClientStore?: ClientStore & { version?: number };
};

export function clientStore(): ClientStore {
  if (globalRef.__healthappClientStore?.version !== STORE_VERSION) {
    globalRef.__healthappClientStore = { ...seed(), version: STORE_VERSION };
  }
  return globalRef.__healthappClientStore;
}

export function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

// ---------- date helpers (local dates, yyyy-mm-dd) ----------

export function isoDay(d: Date = new Date()): string {
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function daysAgoIso(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return isoDay(d);
}

export function daysAgoStamp(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

/** Monday of the week containing today, offset by whole weeks. */
export function mondayOf(weeksBack = 0): string {
  const d = new Date();
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow - weeksBack * 7);
  return isoDay(d);
}

export function daysSince(iso: string | null): number {
  if (!iso) return 99;
  const diff = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(diff / 86_400_000));
}

// ---------- derived reads ----------

/** Best estimated 1RM per exercise across every logged set. */
export function bestLifts(clientId: string): { exercise: string; best: number; at: string }[] {
  const store = clientStore();
  const sessionIds = new Set(store.sessions.filter((s) => s.client_id === clientId).map((s) => s.id));
  const best = new Map<string, { best: number; at: string }>();
  for (const set of store.sets) {
    if (!sessionIds.has(set.session_id)) continue;
    const oneRm = estimated1RM(set.weight_kg, set.reps);
    if (oneRm <= 0) continue;
    const current = best.get(set.exercise_name);
    if (!current || oneRm > current.best) best.set(set.exercise_name, { best: oneRm, at: set.logged_at });
  }
  return [...best.entries()]
    .map(([exercise, v]) => ({ exercise, ...v }))
    .sort((a, b) => b.best - a.best);
}

/** Best 1RM for one exercise, or null — what PR detection compares against. */
export function bestFor(clientId: string, exerciseName: string): number | null {
  const found = bestLifts(clientId).find((b) => b.exercise === exerciseName);
  return found ? found.best : null;
}

export function foodLogsOn(clientId: string, day: string): StoredFoodLog[] {
  return clientStore().foodLogs.filter((f) => f.client_id === clientId && f.logged_on === day);
}

export function totalsOn(clientId: string, day: string): Macros {
  return sumMacros(foodLogsOn(clientId, day).map((f) => f.macros));
}

/** Distinct days with at least one food log, within the last `days` days. */
export function daysLoggedWithin(clientId: string, days: number): number {
  const cutoff = daysAgoIso(days - 1);
  const seen = new Set(
    clientStore()
      .foodLogs.filter((f) => f.client_id === clientId && f.logged_on >= cutoff)
      .map((f) => f.logged_on),
  );
  return seen.size;
}

export function sessionsSince(clientId: string, sinceIso: string): StoredSession[] {
  return clientStore().sessions.filter(
    (s) => s.client_id === clientId && s.completed_at !== null && s.started_at.slice(0, 10) >= sinceIso,
  );
}

/** Most recent activity of any kind — the inactivity input the signal overrides on. */
export function lastActivityAt(clientId: string): string | null {
  const store = clientStore();
  const stamps: string[] = [];
  const sessionIds = new Set(store.sessions.filter((s) => s.client_id === clientId).map((s) => s.id));
  for (const s of store.sets) if (sessionIds.has(s.session_id)) stamps.push(s.logged_at);
  for (const f of store.foodLogs) if (f.client_id === clientId) stamps.push(f.logged_at);
  // Habit logs carry only a habit_id, so they have to be filtered through the
  // habit that owns them — otherwise one client's ticks count as everyone's.
  const habitIds = new Set(store.habits.filter((h) => h.client_id === clientId).map((h) => h.id));
  for (const h of store.habitLogs) {
    if (habitIds.has(h.habit_id)) stamps.push(`${h.done_on}T12:00:00.000Z`);
  }
  if (stamps.length === 0) return null;
  return stamps.sort().at(-1) ?? null;
}

// ---------- seed ----------

/**
 * Maria D. as the coach dashboard already describes her: at risk, one workout
 * this week, barely logging food, check-in missed, quiet for days. The history
 * behind that is real though — eight weeks of measurements and four prior weeks
 * of training — so progress and PR screens have something to show.
 */
function seed(): ClientStore {
  const sessions: StoredSession[] = [];
  const sets: StoredLoggedSet[] = [];

  const template: Record<string, { name: string; weight: number; reps: number; sets: number }[]> = {
    "Legs A": [
      { name: "Barbell Squat", weight: 80, reps: 8, sets: 4 },
      { name: "Romanian Deadlift", weight: 60, reps: 10, sets: 3 },
      { name: "Leg Press", weight: 140, reps: 12, sets: 3 },
    ],
    "Push B": [
      { name: "Bench Press", weight: 70, reps: 6, sets: 4 },
      { name: "Overhead Press", weight: 40, reps: 8, sets: 3 },
    ],
  };

  // Four prior weeks progressing ~2.5% a week, then this week's single session.
  const plan: { daysAgo: number; day: keyof typeof template; scale: number }[] = [
    { daysAgo: 31, day: "Legs A", scale: 0.9 },
    { daysAgo: 28, day: "Push B", scale: 0.9 },
    { daysAgo: 24, day: "Legs A", scale: 0.93 },
    { daysAgo: 21, day: "Push B", scale: 0.93 },
    { daysAgo: 17, day: "Legs A", scale: 0.96 },
    { daysAgo: 14, day: "Push B", scale: 0.96 },
    { daysAgo: 10, day: "Legs A", scale: 1.0 },
    { daysAgo: 8, day: "Push B", scale: 1.0 },
    { daysAgo: 5, day: "Legs A", scale: 1.02 },
  ];

  const bestSoFar = new Map<string, number>();
  for (const entry of plan) {
    const sessionId = newId("ls");
    sessions.push({
      id: sessionId,
      client_id: DEMO_CLIENT_ID,
      program_day_id: null,
      day_name: entry.day,
      started_at: daysAgoStamp(entry.daysAgo),
      completed_at: daysAgoStamp(entry.daysAgo),
    });
    for (const ex of template[entry.day]) {
      const weight = Math.round(ex.weight * entry.scale * 2) / 2;
      for (let i = 0; i < ex.sets; i++) {
        const oneRm = estimated1RM(weight, ex.reps);
        const prior = bestSoFar.get(ex.name) ?? null;
        const isPr = prior === null ? i === 0 : oneRm > prior;
        if (isPr) bestSoFar.set(ex.name, oneRm);
        sets.push({
          id: newId("lst"),
          session_id: sessionId,
          program_exercise_id: null, // history, not tied to a live program row
          exercise_name: ex.name,
          set_index: i + 1,
          weight_kg: weight,
          reps: ex.reps,
          rpe: 2,
          is_pr: isPr,
          logged_at: daysAgoStamp(entry.daysAgo),
        });
      }
    }
  }

  // Food: solid until about a week ago, then it stops — what put her at risk.
  const foodLogs: StoredFoodLog[] = [];
  const dayMeals: { slot: MealSlot; name: string; grams: number; per100: Macros }[] = [
    { slot: "breakfast", name: "Oats", grams: 60, per100: { kcal: 389, protein: 16.9, carbs: 66.3, fat: 6.9 } },
    { slot: "breakfast", name: "Whey isolate", grams: 30, per100: { kcal: 370, protein: 85, carbs: 4, fat: 1.5 } },
    { slot: "lunch", name: "Chicken breast, raw", grams: 200, per100: { kcal: 165, protein: 31, carbs: 0, fat: 3.6 } },
    { slot: "lunch", name: "Rice, cooked", grams: 180, per100: { kcal: 130, protein: 2.7, carbs: 28, fat: 0.3 } },
    { slot: "dinner", name: "Salmon", grams: 150, per100: { kcal: 208, protein: 20, carbs: 0, fat: 13 } },
    { slot: "dinner", name: "Potatoes", grams: 250, per100: { kcal: 77, protein: 2, carbs: 17, fat: 0.1 } },
  ];
  for (const back of [30, 29, 28, 26, 25, 23, 22, 21, 19, 18, 16, 15, 14, 12, 11, 9, 8, 6]) {
    for (const meal of dayMeals) {
      foodLogs.push({
        id: newId("fl"),
        client_id: DEMO_CLIENT_ID,
        logged_on: daysAgoIso(back),
        slot: meal.slot,
        food_name: meal.name,
        grams: meal.grams,
        macros: portionMacros(meal.per100, meal.grams),
        per_100g: meal.per100,
        logged_at: daysAgoStamp(back),
      });
    }
  }
  // One lonely log inside the current 7-day window — "food logged 1/7 days".
  for (const meal of dayMeals.slice(0, 2)) {
    foodLogs.push({
      id: newId("fl"),
      client_id: DEMO_CLIENT_ID,
      logged_on: daysAgoIso(5),
      slot: meal.slot,
      food_name: meal.name,
      grams: meal.grams,
      macros: portionMacros(meal.per100, meal.grams),
      per_100g: meal.per100,
      logged_at: daysAgoStamp(5),
    });
  }

  const habits: StoredHabit[] = [
    { id: "hb1", client_id: DEMO_CLIENT_ID, name: "10 000 steps", target_per_week: 7, archived: false },
    { id: "hb2", client_id: DEMO_CLIENT_ID, name: "Protein 150 g+", target_per_week: 7, archived: false },
    { id: "hb3", client_id: DEMO_CLIENT_ID, name: "Sleep 7 h+", target_per_week: 7, archived: false },
  ];
  const habitLogs: StoredHabitLog[] = [];
  for (const back of [30, 29, 28, 27, 26, 24, 23, 22, 21, 20, 18, 17, 16, 14, 13, 11, 9, 8]) {
    habitLogs.push({ id: newId("hl"), habit_id: "hb1", done_on: daysAgoIso(back) });
    if (back % 2 === 0) habitLogs.push({ id: newId("hl"), habit_id: "hb2", done_on: daysAgoIso(back) });
    if (back % 3 === 0) habitLogs.push({ id: newId("hl"), habit_id: "hb3", done_on: daysAgoIso(back) });
  }
  habitLogs.push({ id: newId("hl"), habit_id: "hb1", done_on: daysAgoIso(5) });

  // Eight weeks of weight, trending down ~0.35 kg a week on a cut.
  const measurements: StoredMeasurement[] = [];
  const weights = [69.8, 69.4, 69.1, 68.6, 68.4, 68.0, 67.7, 67.4];
  weights.forEach((kg, i) => {
    const back = (weights.length - 1 - i) * 7;
    measurements.push({
      id: newId("me"),
      client_id: DEMO_CLIENT_ID,
      taken_on: daysAgoIso(back),
      weight_kg: kg,
      waist_cm: Math.round((74 - i * 0.4) * 10) / 10,
    });
  });

  // Last week reviewed; this week still missing — the "check-in missed" signal.
  const checkIns: StoredClientCheckIn[] = [
    {
      id: newId("ci"),
      client_id: DEMO_CLIENT_ID,
      week_start: mondayOf(1),
      weight_kg: 67.7,
      sleep: 6,
      energy: 6,
      stress: 5,
      hunger: 6,
      recovery: 6,
      note: "Legs felt heavy on Thursday but the squat went up.",
      submitted_at: daysAgoStamp(8),
      coach_reviewed_at: daysAgoStamp(7),
      coach_feedback: "Good week. Keep protein at 150 g and we hold the deficit for two more weeks.",
    },
  ];

  return { sessions, sets, foodLogs, habits, habitLogs, measurements, checkIns };
}
