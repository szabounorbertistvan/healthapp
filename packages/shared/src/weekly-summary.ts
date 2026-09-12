// Weekly summary — one week of a client's training, nutrition, progress and
// consistency, folded from the rows the app already stores, and compared to
// the week before. Nothing here is entered by hand and nothing is persisted:
// like training load, it is computed at read time so it can never disagree
// with the underlying logs. Weeks run Monday → Sunday on local yyyy-mm-dd
// strings, the same calendar adherence and check-ins use.
import { macroScore } from "./adherence";
import type { Macros } from "./macros";

// ---------- weeks ----------

export type Week = { start: string; end: string };

function parseUtc(day: string): number {
  const [y = 0, m = 1, d = 1] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function fmtUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function shiftDays(day: string, days: number): string {
  return fmtUtc(parseUtc(day) + days * 86_400_000);
}

/** Monday → Sunday of the week containing `day`. */
export function weekOf(day: string): Week {
  const dow = (new Date(parseUtc(day)).getUTCDay() + 6) % 7; // 0 = Monday
  const start = shiftDays(day, -dow);
  return { start, end: shiftDays(start, 6) };
}

export function previousWeek(week: Week): Week {
  return { start: shiftDays(week.start, -7), end: shiftDays(week.end, -7) };
}

export function inWeek(day: string, week: Week): boolean {
  return day >= week.start && day <= week.end;
}

// ---------- inputs ----------

/** One completed session, already scored (training-load.ts) and PR-flagged. */
export type WeeklySession = {
  day: string;
  duration_min: number | null;
  load: number;
  volume_kg: number;
  sets: number;
  /** Distinct exercise names / ids performed. */
  exercises: string[];
  /** Sets flagged is_pr by the PR engine, with what was lifted. */
  prs: { exercise: string; weight_kg: number; reps: number }[];
};

export type WeeklyFoodDay = { day: string } & Macros;

export type WeeklyMeasurement = {
  day: string;
  weight_kg: number | null;
  /** Circumferences in cm by name (waist, chest, hips, …); absent keys were not measured. */
  circumferences: Record<string, number>;
};

export type WeeklyInput = {
  week: Week;
  sessions: WeeklySession[];
  food_days: WeeklyFoodDay[];
  /** Daily targets from the published plan; null when the client has none. */
  target: Macros | null;
  measurements: WeeklyMeasurement[];
  /** Days with any logged activity (session, food, habit). */
  active_days: string[];
  /** Sessions the program prescribes per week; 0 when there is no program. */
  planned_workouts: number;
  /** Current streak in days (the streak engine's number, not recomputed here). */
  streak_days: number;
};

// ---------- one week ----------

export type TrainingStats = {
  workouts: number;
  duration_min: number;
  load: number;
  volume_kg: number;
  exercises: number;
  sets: number;
  prs: number;
  pr_lifts: { exercise: string; weight_kg: number; reps: number }[];
};

export type NutritionStats = {
  days_logged: number;
  /** Per-day averages over logged days; null when nothing was logged. */
  avg: Macros | null;
  /** 0..100 against the plan's kcal target; null without a plan or without logs. */
  adherence_pct: number | null;
};

export type Change = { start: number; end: number; delta: number };

export type ProgressStats = {
  /** First and last weigh-in of the week; null unless two different days were measured. */
  weight: Change | null;
  waist: Change | null;
  /** Any other circumference measured on two different days of the week. */
  others: Record<string, Change>;
};

export type ConsistencyStats = {
  active_days: number;
  workout_days: number;
  planned_workouts: number;
  /** completed / planned, capped at 100; null when nothing is planned. */
  completion_pct: number | null;
  streak_days: number;
};

export type WeekStats = {
  week: Week;
  training: TrainingStats;
  nutrition: NutritionStats;
  progress: ProgressStats;
  consistency: ConsistencyStats;
};

export function weekStats(input: WeeklyInput): WeekStats {
  const { week } = input;
  const sessions = input.sessions.filter((s) => inWeek(s.day, week));

  const exerciseNames = new Set<string>();
  for (const s of sessions) for (const e of s.exercises) exerciseNames.add(e);
  const pr_lifts = sessions.flatMap((s) => s.prs);

  const training: TrainingStats = {
    workouts: sessions.length,
    duration_min: sessions.reduce((sum, s) => sum + (s.duration_min ?? 0), 0),
    load: Math.round(sessions.reduce((sum, s) => sum + s.load, 0)),
    volume_kg: Math.round(sessions.reduce((sum, s) => sum + s.volume_kg, 0)),
    exercises: exerciseNames.size,
    sets: sessions.reduce((sum, s) => sum + s.sets, 0),
    prs: pr_lifts.length,
    pr_lifts,
  };

  const foodDays = input.food_days.filter((d) => inWeek(d.day, week) && d.kcal > 0);
  const nutrition: NutritionStats = {
    days_logged: foodDays.length,
    avg:
      foodDays.length === 0
        ? null
        : {
            kcal: Math.round(foodDays.reduce((s, d) => s + d.kcal, 0) / foodDays.length),
            protein: Math.round(foodDays.reduce((s, d) => s + d.protein, 0) / foodDays.length),
            carbs: Math.round(foodDays.reduce((s, d) => s + d.carbs, 0) / foodDays.length),
            fat: Math.round(foodDays.reduce((s, d) => s + d.fat, 0) / foodDays.length),
          },
    adherence_pct:
      foodDays.length === 0 || !input.target || input.target.kcal <= 0
        ? null
        : Math.round(macroScore(foodDays, input.target.kcal) * 100),
  };

  const progress = progressStats(input.measurements.filter((m) => inWeek(m.day, week)));

  const workoutDays = new Set(sessions.map((s) => s.day));
  const activeDays = new Set([...input.active_days.filter((d) => inWeek(d, week)), ...workoutDays]);
  const planned = Math.max(0, input.planned_workouts);
  const consistency: ConsistencyStats = {
    active_days: activeDays.size,
    workout_days: workoutDays.size,
    planned_workouts: planned,
    completion_pct: planned > 0 ? Math.min(100, Math.round((sessions.length / planned) * 100)) : null,
    streak_days: input.streak_days,
  };

  return { week, training, nutrition, progress, consistency };
}

/** First vs last reading of the week, per measure; nothing is interpolated. */
function progressStats(measurements: WeeklyMeasurement[]): ProgressStats {
  const sorted = [...measurements].sort((a, b) => a.day.localeCompare(b.day));
  const change = (pick: (m: WeeklyMeasurement) => number | null | undefined): Change | null => {
    const points = sorted
      .map((m) => ({ day: m.day, v: pick(m) }))
      .filter((p): p is { day: string; v: number } => typeof p.v === "number" && Number.isFinite(p.v));
    if (points.length < 2) return null;
    const first = points[0]!;
    const last = points[points.length - 1]!;
    if (first.day === last.day) return null;
    return { start: first.v, end: last.v, delta: round1(last.v - first.v) };
  };
  const weight = change((m) => m.weight_kg);
  const waist = change((m) => m.circumferences.waist);
  const names = new Set<string>();
  for (const m of sorted) for (const k of Object.keys(m.circumferences)) if (k !== "waist") names.add(k);
  const others: Record<string, Change> = {};
  for (const name of names) {
    const c = change((m) => m.circumferences[name]);
    if (c) others[name] = c;
  }
  return { weight, waist, others };
}

// ---------- comparison ----------

export type Direction = "up" | "down" | "stable";

export type Delta = {
  current: number;
  previous: number;
  delta: number;
  /** Signed percent change, one decimal; null when there is nothing to compare against. */
  pct: number | null;
  direction: Direction;
};

/** Under this relative change a metric reads as stable. */
export const WEEKLY_STABLE_BAND = 0.05;

export function delta(current: number, previous: number): Delta {
  const d = round1(current - previous);
  if (previous === 0) {
    return { current, previous, delta: d, pct: null, direction: current > 0 ? "up" : "stable" };
  }
  const ratio = (current - previous) / Math.abs(previous);
  const direction: Direction = Math.abs(ratio) < WEEKLY_STABLE_BAND ? "stable" : ratio > 0 ? "up" : "down";
  return { current, previous, delta: d, pct: Math.round(ratio * 1000) / 10, direction };
}

/** Nullable metrics (averages, adherence) compare only when both weeks have a value. */
export function deltaOrNull(current: number | null, previous: number | null): Delta | null {
  if (current === null) return null;
  return delta(current, previous ?? 0);
}

export type WeeklyComparison = {
  current: WeekStats;
  previous: WeekStats;
  training: {
    workouts: Delta;
    duration_min: Delta;
    load: Delta;
    volume_kg: Delta;
    exercises: Delta;
    sets: Delta;
    prs: Delta;
  };
  nutrition: {
    kcal: Delta | null;
    protein: Delta | null;
    carbs: Delta | null;
    fat: Delta | null;
    adherence_pct: Delta | null;
  };
  consistency: {
    active_days: Delta;
    workout_days: Delta;
    completion_pct: Delta | null;
  };
  insights: Insight[];
};

export function compareWeeks(current: WeekStats, previous: WeekStats): WeeklyComparison {
  const t = current.training;
  const p = previous.training;
  const comparison: Omit<WeeklyComparison, "insights"> = {
    current,
    previous,
    training: {
      workouts: delta(t.workouts, p.workouts),
      duration_min: delta(t.duration_min, p.duration_min),
      load: delta(t.load, p.load),
      volume_kg: delta(t.volume_kg, p.volume_kg),
      exercises: delta(t.exercises, p.exercises),
      sets: delta(t.sets, p.sets),
      prs: delta(t.prs, p.prs),
    },
    nutrition: {
      kcal: deltaOrNull(current.nutrition.avg?.kcal ?? null, previous.nutrition.avg?.kcal ?? null),
      protein: deltaOrNull(current.nutrition.avg?.protein ?? null, previous.nutrition.avg?.protein ?? null),
      carbs: deltaOrNull(current.nutrition.avg?.carbs ?? null, previous.nutrition.avg?.carbs ?? null),
      fat: deltaOrNull(current.nutrition.avg?.fat ?? null, previous.nutrition.avg?.fat ?? null),
      adherence_pct: deltaOrNull(current.nutrition.adherence_pct, previous.nutrition.adherence_pct),
    },
    consistency: {
      active_days: delta(current.consistency.active_days, previous.consistency.active_days),
      workout_days: delta(current.consistency.workout_days, previous.consistency.workout_days),
      completion_pct: deltaOrNull(current.consistency.completion_pct, previous.consistency.completion_pct),
    },
  };
  return { ...comparison, insights: weeklyInsights(comparison) };
}

// ---------- insight ----------

/** A deterministic observation; the UI turns the key into a sentence. */
export type Insight =
  | { key: "load_up"; pct: number }
  | { key: "load_down"; pct: number }
  | { key: "more_workouts"; count: number }
  | { key: "fewer_workouts"; count: number }
  | { key: "prs"; count: number }
  | { key: "volume_up"; pct: number }
  | { key: "volume_down"; pct: number }
  | { key: "all_planned_done" }
  | { key: "nutrition_adherence"; pct: number }
  | { key: "weight_change"; delta: number }
  | { key: "no_data" };

/** A relative change this big is "significant". */
export const SIGNIFICANT_PCT = 10;
export const MAX_INSIGHTS = 3;

/**
 * Strictly from the numbers, in a fixed priority order, at most three. The
 * first slot is the headline (load or workouts), then PRs, then whatever
 * else stands out. No week of data at all yields the "keep training" nudge.
 */
export function weeklyInsights(c: Omit<WeeklyComparison, "insights">): Insight[] {
  const cur = c.current;
  const hasData =
    cur.training.workouts > 0 || cur.nutrition.days_logged > 0 || cur.consistency.active_days > 0;
  if (!hasData) return [{ key: "no_data" }];

  const out: Insight[] = [];
  const push = (i: Insight) => {
    if (out.length < MAX_INSIGHTS) out.push(i);
  };

  const load = c.training.load;
  const workouts = c.training.workouts;
  if (load.pct !== null && load.pct >= SIGNIFICANT_PCT) push({ key: "load_up", pct: load.pct });
  else if (workouts.delta > 0) push({ key: "more_workouts", count: workouts.delta });
  else if (load.pct !== null && load.pct <= -SIGNIFICANT_PCT) push({ key: "load_down", pct: Math.abs(load.pct) });
  else if (workouts.delta < 0 && c.previous.training.workouts > 0) push({ key: "fewer_workouts", count: -workouts.delta });

  if (cur.training.prs > 0) push({ key: "prs", count: cur.training.prs });

  const volume = c.training.volume_kg;
  if (volume.pct !== null && volume.pct <= -SIGNIFICANT_PCT) push({ key: "volume_down", pct: Math.abs(volume.pct) });
  else if (volume.pct !== null && volume.pct >= SIGNIFICANT_PCT && !out.some((i) => i.key === "load_up")) {
    push({ key: "volume_up", pct: volume.pct });
  }

  if (cur.consistency.completion_pct === 100 && cur.consistency.planned_workouts > 0) push({ key: "all_planned_done" });
  if (cur.nutrition.adherence_pct !== null && cur.nutrition.adherence_pct >= 90) {
    push({ key: "nutrition_adherence", pct: cur.nutrition.adherence_pct });
  }
  if (cur.progress.weight && cur.progress.weight.delta !== 0) push({ key: "weight_change", delta: cur.progress.weight.delta });

  return out.length > 0 ? out : [{ key: "no_data" }];
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
