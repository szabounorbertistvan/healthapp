// Fitness score — one 0..100 number summarising how much someone has been
// training over the last 28 days. It is an APPLICATION ACTIVITY METRIC: an
// aggregation of signals the app already computes from logged sessions
// (training load, active days, workout count, tonnage). It says nothing about
// health, fitness in the physiological sense, or body composition, and it
// reads nothing but completed logged_sessions and their sets.
//
// Like training load and streaks it is derived, never stored: the same
// sessions always yield the same score, and the previous 28-day window is
// scored by the very same function for the trend.
//
//   score = 0.35 · trainingLoad + 0.25 · consistency + 0.20 · frequency + 0.20 · volume
//
// Each component is a 0..100 subscore:
// - trainingLoad: the mean per-session training load (training-load.ts) over
//   the window, pushed through the same saturating curve the load itself
//   uses (TRAINING_LOAD_SCALE). A steady diet of moderate sessions reads ~75.
// - consistency: distinct active workout days / 16, linear, capped. 16 days
//   is four days a week for four weeks. A day is where started_at falls in
//   the user's own timezone — the streak rule (streaks.ts), not UTC.
// - frequency: completed workouts / 16, linear, capped. Three sessions on
//   one day are three workouts but one active day.
// - volume: total kg lifted / VOLUME_REFERENCE_KG, linear, capped. The
//   50,000 kg reference is a scoring anchor chosen for this app (about
//   3,000 kg per session at the 16-session target); it is not a claim about
//   what anyone should lift.
//
// Fewer than FITNESS_SCORE_MIN_WORKOUTS completed workouts in the window means
// the number would be noise, so the score is null with status "building";
// the components are still reported so the UI can show what exists.
import { getActiveWorkoutDays, localDay } from "./streaks";
import { saturate } from "./training-load";
import { shiftDays } from "./weekly-summary";

export const FITNESS_SCORE_PERIOD_DAYS = 28;
export const FITNESS_SCORE_MIN_WORKOUTS = 3;
export const FITNESS_SCORE_WEIGHTS = { trainingLoad: 0.35, consistency: 0.25, frequency: 0.2, volume: 0.2 } as const;
/** Active workout days in 28 days that score 100 (4 / week). */
export const CONSISTENCY_TARGET_DAYS = 16;
/** Completed workouts in 28 days that score 100 (4 / week). */
export const FREQUENCY_TARGET_WORKOUTS = 16;
/** Total kg over 28 days that scores 100 — an app-level reference, see header. */
export const VOLUME_REFERENCE_KG = 50_000;
/** Mean session load at which the training-load subscore reaches ~63 (1 − e⁻¹). */
export const TRAINING_LOAD_SCALE = 40;

/** One logged session, already scored by training-load.ts. */
export type FitnessScoreSession = {
  started_at: string;
  completed_at: string | null;
  /** The session's training load, 0..100. */
  load: number;
  /** The session's tonnage as training-load.ts computes it. */
  volume_kg: number;
};

export type FitnessScoreInput = {
  sessions: readonly FitnessScoreSession[];
  /** users.timezone — the calendar the days are counted on. */
  timeZone: string;
  /** Local yyyy-mm-dd the window ends on, from todayIn(timeZone). */
  today: string;
  /** 0 = the 28 days ending today; 1 = the 28 days before those. */
  periodsAgo?: number;
};

export type FitnessScoreStatus = "building" | "active";

/** Neutral activity ranges — descriptions of app activity, not of a person. */
export type FitnessScoreBand = "getting_started" | "building" | "developing" | "strong_activity";

export type FitnessScoreWindow = { start: string; end: string };

export type FitnessScore = {
  /** Rounded to an integer for display; null while building. */
  score: number | null;
  status: FitnessScoreStatus;
  band: FitnessScoreBand | null;
  /** Unrounded 0..100 subscores. */
  trainingLoadScore: number;
  consistencyScore: number;
  frequencyScore: number;
  volumeScore: number;
  periodDays: typeof FITNESS_SCORE_PERIOD_DAYS;
  /** Inclusive local days the score covers. */
  period: FitnessScoreWindow;
  activeWorkoutDays: number;
  completedWorkouts: number;
  /** kg, summed over the window's completed sessions. */
  totalVolume: number;
  /** Mean session load over the window's completed sessions; 0 when there are none. */
  averageTrainingLoad: number;
};

/** The 28 inclusive local days ending `today`, or the block `periodsAgo` blocks earlier. */
export function fitnessScoreWindow(today: string, periodsAgo = 0): FitnessScoreWindow {
  const end = shiftDays(today, -periodsAgo * FITNESS_SCORE_PERIOD_DAYS);
  return { start: shiftDays(end, -(FITNESS_SCORE_PERIOD_DAYS - 1)), end };
}

export function fitnessScore(input: FitnessScoreInput): FitnessScore {
  const period = fitnessScoreWindow(input.today, input.periodsAgo ?? 0);
  const sessions = input.sessions.filter((s) => {
    if (s.completed_at === null) return false;
    const day = localDay(s.started_at, input.timeZone);
    return day >= period.start && day <= period.end;
  });

  const completedWorkouts = sessions.length;
  const activeWorkoutDays = getActiveWorkoutDays(sessions, input.timeZone).length;
  const totalVolume = sessions.reduce((sum, s) => sum + finite(s.volume_kg), 0);
  const averageTrainingLoad =
    completedWorkouts === 0 ? 0 : sessions.reduce((sum, s) => sum + finite(s.load), 0) / completedWorkouts;

  const trainingLoadScore = clamp(saturate(averageTrainingLoad, TRAINING_LOAD_SCALE), 0, 100);
  const consistencyScore = clamp((activeWorkoutDays / CONSISTENCY_TARGET_DAYS) * 100, 0, 100);
  const frequencyScore = clamp((completedWorkouts / FREQUENCY_TARGET_WORKOUTS) * 100, 0, 100);
  const volumeScore = clamp((totalVolume / VOLUME_REFERENCE_KG) * 100, 0, 100);

  const building = completedWorkouts < FITNESS_SCORE_MIN_WORKOUTS;
  const w = FITNESS_SCORE_WEIGHTS;
  const score = building
    ? null
    : clamp(
        Math.round(
          trainingLoadScore * w.trainingLoad + consistencyScore * w.consistency + frequencyScore * w.frequency + volumeScore * w.volume,
        ),
        0,
        100,
      );

  return {
    score,
    status: building ? "building" : "active",
    band: score === null ? null : fitnessScoreBand(score),
    trainingLoadScore,
    consistencyScore,
    frequencyScore,
    volumeScore,
    periodDays: FITNESS_SCORE_PERIOD_DAYS,
    period,
    activeWorkoutDays,
    completedWorkouts,
    totalVolume,
    averageTrainingLoad,
  };
}

export function fitnessScoreBand(score: number): FitnessScoreBand {
  if (score >= 80) return "strong_activity";
  if (score >= 60) return "developing";
  if (score >= 40) return "building";
  return "getting_started";
}

export type FitnessScoreTrend = {
  current: number | null;
  previous: number | null;
  /** current − previous on the displayed integers; null unless both periods are active. */
  delta: number | null;
  direction: "up" | "down" | "stable";
};

/** This 28-day block against the one before, both scored by fitnessScore(). */
export function fitnessScoreTrend(current: FitnessScore, previous: FitnessScore): FitnessScoreTrend {
  if (current.score === null || previous.score === null) {
    return { current: current.score, previous: previous.score, delta: null, direction: "stable" };
  }
  const delta = current.score - previous.score;
  return { current: current.score, previous: previous.score, delta, direction: delta > 0 ? "up" : delta < 0 ? "down" : "stable" };
}

function finite(n: number): number {
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
