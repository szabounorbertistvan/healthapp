// The Goal dashboard's read: one person's goals and, for each, its real
// progress — computed now from the rows the Progress dashboard already reads,
// never stored.
//
//   body weight / circumference   measurements (measurementsFor)
//   lift                          completed sessions' sets (progressTrainingFor — the
//                                 strength tab's own read, all time)
//   workouts a week / consistency the same completed sessions, on the person's calendar
//   calories on target / protein  day totals (nutritionTrendsFor) against the
//                                 diary's own target (nutritionTargetFor)
//
// Whose: the signed-in person's own (getMyGoalDashboard), or a client's for
// their coach (getClientGoalDashboard). Every read is filtered by that user id
// and RLS answers it — goals_owner / goals_coach_read and the matching policies
// on the source tables; the coach's day totals come through
// client_food_daily_totals(). An unrelated caller gets no rows. Nothing here writes.
import "server-only";
import {
  consistencySeries,
  GOAL_MEASURE_KEYS,
  goalProgress,
  isGoalDirection,
  isGoalMetric,
  isGoalStatus,
  kcalOnTargetSeries,
  liftSeries,
  measurementSeries,
  proteinAvgSeries,
  weeklyWorkoutsSeries,
  type GoalDirection,
  type GoalMetric,
  type GoalPoint,
  type GoalProgress,
  type GoalSeries,
  type GoalStatus,
} from "@healthapp/shared";
import { getMyPrs } from "./client-data";
import { nutritionTargetFor } from "./client-nutrition";
import { measurementsFor } from "./client-progress";
import { myCalendar, userCalendar } from "./my-today";
import { nutritionTrendsFor } from "./nutrition-data";
import { progressTrainingFor } from "./progress-data";
import { liveUser } from "./supabase/server";
import type { Calendar } from "./week-activity";

export type GoalView = {
  id: string;
  title: string;
  metric: GoalMetric;
  direction: GoalDirection;
  target_value: number;
  start_value: number | null;
  start_date: string;
  target_date: string | null;
  status: GoalStatus;
  exercise_id: string | null;
  exercise_name: string | null;
  measure_key: string | null;
  achieved_at: string | null;
  closed_at: string | null;
  progress: GoalProgress;
  /** Real values since a little before the start, oldest first, canonical unit. */
  points: GoalPoint[];
};

/** A metric's value right now, for the create form: what the start would be. */
export type GoalCurrent = { value: number | null; missing: GoalSeries["missing"] };

export type GoalDashboard = {
  today: string;
  /** The words-only main goal from the setup steps (metric is null), if any. */
  mainGoal: string | null;
  active: GoalView[];
  closed: GoalView[];
  /** Current value per goal source (goalSourceKey shape without the metric prefix for plain metrics). */
  current: {
    body_weight: GoalCurrent;
    weekly_workouts: GoalCurrent;
    consistency: GoalCurrent;
    kcal_on_target: GoalCurrent;
    protein_avg: GoalCurrent;
    circumference: Record<string, GoalCurrent>;
  };
  /** Lifts the person has logged (a lift goal follows one of these), heaviest first by 1RM. */
  exercises: { id: string; name: string; current: number | null }[];
  /** The diary's calorie target, when there is one (kcal goals need it). */
  kcalTarget: number | null;
};

/** Closed goals kept on the dashboard as history. */
const CLOSED_SHOWN = 30;
/** Rows read at most — active ones are capped at 12 by the database. */
const GOAL_ROWS = 60;
/** How far before the start a chart reaches back, for context. */
const CHART_LEAD_DAYS = 30;

type GoalRow = {
  id: string; title: string; metric: string | null; direction: string | null;
  target_value: number | string | null; start_value: number | string | null;
  start_date: string | null; target_date: string | null; status: string;
  exercise_id: string | null; measure_key: string | null;
  achieved_at: string | null; closed_at: string | null; created_at: string;
  exercise: { name_en: string; name_ro: string | null } | null;
};

function num(v: number | string | null): number | null {
  if (v === null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function shift(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

function asCurrent(s: GoalSeries): GoalCurrent {
  return { value: s.current?.value ?? null, missing: s.missing };
}

/** The signed-in person's own dashboard. */
export async function getMyGoalDashboard(): Promise<GoalDashboard | null> {
  const live = await liveUser();
  if (!live) return null;
  return goalDashboardFor(live.userId, await myCalendar());
}

/**
 * A client's dashboard as their coach sees it, on the client's own calendar.
 * The id comes from the URL and nothing here trusts it: RLS answers every
 * read, and the page renders it only for a client on the coach's roster.
 */
export async function getClientGoalDashboard(clientId: string): Promise<GoalDashboard | null> {
  return goalDashboardFor(clientId, await userCalendar(clientId));
}

export async function goalDashboardFor(userId: string, calendar: Calendar): Promise<GoalDashboard | null> {
  const live = await liveUser();
  if (!live) return null;
  const { supabase } = live;
  // The lift list offered by the create form comes off exercise_best_sets(),
  // which answers for auth.uid() only — and only the owner creates goals.
  const own = live.userId === userId;

  // One wave. Each reader is request-cached or cheap; the Progress page's own
  // tab reads are not repeated, because only the Goals tab calls this.
  const [goalsRes, mainRes, measurements, training, prs, nutrition, kcalPlan] = await Promise.all([
    supabase
      .from("goals")
      .select(`id, title, metric, direction, target_value, start_value, start_date, target_date, status,
        exercise_id, measure_key, achieved_at, closed_at, created_at, exercise:exercises(name_en, name_ro)`)
      .eq("user_id", userId)
      .not("metric", "is", null)
      .order("created_at", { ascending: false })
      .limit(GOAL_ROWS),
    supabase
      .from("goals").select("title").eq("user_id", userId).eq("status", "active").is("metric", null)
      .order("created_at", { ascending: false }).limit(1).maybeSingle<{ title: string }>(),
    measurementsFor(userId, 500),
    progressTrainingFor(userId, null),
    own ? getMyPrs() : Promise.resolve([]),
    nutritionTrendsFor(userId, calendar, 30),
    nutritionTargetFor(userId),
  ]);
  // A failed goals read must not look like "no goals yet".
  if (goalsRes.error) throw new Error(`Failed to load goals: ${goalsRes.error.message}`);

  const today = calendar.today;
  const measurementRows = measurements.map((m) => ({ day: m.taken_on, weight_kg: m.weight_kg, circumferences: m.circumferences }));
  const sessionDays = training.sessions.map((s) => s.day);
  const nutritionDays = nutrition?.days ?? [];
  const kcalTarget = kcalPlan.kcal > 0 ? kcalPlan.kcal : null;

  // Each source computed once, shared by every goal on it and by the form.
  const cache = new Map<string, GoalSeries>();
  const seriesFor = (metric: GoalMetric, exerciseId: string | null, key: string | null): GoalSeries => {
    const id = `${metric}:${exerciseId ?? ""}:${key ?? ""}`;
    const hit = cache.get(id);
    if (hit) return hit;
    let s: GoalSeries;
    switch (metric) {
      case "body_weight": s = measurementSeries(measurementRows, "body_weight"); break;
      case "circumference": s = measurementSeries(measurementRows, "circumference", key); break;
      case "lift_weight": s = exerciseId ? liftSeries(training.sessions, exerciseId) : { current: null, points: [], missing: "no_lift_sets" }; break;
      case "weekly_workouts": s = weeklyWorkoutsSeries(sessionDays, today, training.firstDay); break;
      case "consistency": s = consistencySeries(sessionDays, today, training.firstDay); break;
      case "kcal_on_target": s = kcalOnTargetSeries(nutritionDays, kcalTarget, today); break;
      case "protein_avg": s = proteinAvgSeries(nutritionDays, today); break;
    }
    cache.set(id, s);
    return s;
  };

  const views: GoalView[] = [];
  for (const r of (goalsRes.data ?? []) as unknown as GoalRow[]) {
    const target = num(r.target_value);
    // A row the constraints would not let in today is skipped, not shown half-read.
    if (!isGoalMetric(r.metric) || !isGoalDirection(r.direction) || !isGoalStatus(r.status) || target === null || !r.start_date) continue;
    const s = seriesFor(r.metric, r.exercise_id, r.measure_key);
    const goal = {
      metric: r.metric, direction: r.direction, target_value: target, start_value: num(r.start_value),
      start_date: r.start_date, target_date: r.target_date, status: r.status,
    };
    const chartFrom = shift(r.start_date, -CHART_LEAD_DAYS);
    views.push({
      id: r.id,
      title: r.title,
      ...goal,
      exercise_id: r.exercise_id,
      exercise_name: r.exercise ? (r.exercise.name_ro ?? r.exercise.name_en) : null,
      measure_key: r.measure_key,
      achieved_at: r.achieved_at,
      closed_at: r.closed_at,
      progress: goalProgress(goal, s, today),
      points: s.points.filter((p) => p.day >= chartFrom),
    });
  }

  // Lifts offered for a new goal: the ones a PR exists for (every loaded lift's first set is one).
  const exercises = prs
    .filter((p): p is typeof p & { exercise_id: string } => p.exercise_id !== null)
    .map((p) => ({ id: p.exercise_id, name: p.exercise, current: seriesFor("lift_weight", p.exercise_id, null).current?.value ?? null }));

  // Circumference keys: the ones the person has measured, plus waist (the one the form records).
  const measuredKeys = new Set<string>(["waist"]);
  for (const m of measurements) for (const k of Object.keys(m.circumferences ?? {})) measuredKeys.add(k);
  const circumference: Record<string, GoalCurrent> = {};
  for (const k of GOAL_MEASURE_KEYS) if (measuredKeys.has(k)) circumference[k] = asCurrent(seriesFor("circumference", null, k));

  return {
    today,
    mainGoal: mainRes.error ? null : (mainRes.data?.title ?? null),
    active: views.filter((v) => v.status === "active"),
    closed: views.filter((v) => v.status !== "active")
      .sort((a, b) => (b.closed_at ?? "").localeCompare(a.closed_at ?? ""))
      .slice(0, CLOSED_SHOWN),
    current: {
      body_weight: asCurrent(seriesFor("body_weight", null, null)),
      weekly_workouts: asCurrent(seriesFor("weekly_workouts", null, null)),
      consistency: asCurrent(seriesFor("consistency", null, null)),
      kcal_on_target: asCurrent(seriesFor("kcal_on_target", null, null)),
      protein_avg: asCurrent(seriesFor("protein_avg", null, null)),
      circumference,
    },
    exercises,
    kcalTarget,
  };
}
