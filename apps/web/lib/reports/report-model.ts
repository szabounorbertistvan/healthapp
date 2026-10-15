// The progress report, as data: one pure function from the person's own rows
// (already read and scored by lib/reports/report-data.ts) to the sections a PDF
// and the preview show. It computes nothing the app does not already compute
// elsewhere — every figure comes from an existing function:
//
//   workouts, frequency, volume, PRs, load    trainingProgress / periodBuckets  (packages/shared/progress)
//   per-session load score                    loadOf, inside toProgressSessions (lib/progress-map)
//   Fitness Score                             fitnessScore() for the 28 days ending on the period's last day
//   exercise performance                      sessionPerformance / relevantOneRm (shared/exercise-progression)
//   PR value                                  estimated1RM — the PR judge's own rounded number
//   body comparison                           compareMeasurements (shared/progress)
//   nutrition averages and target             nutritionPeriod / labelNutrients (shared/nutrition-progress)
//   goals                                     the Goal dashboard's GoalView (lib/goals-data)
//
// Rules: a section with no data says so (available: false + why) and is never
// filled with zeros; a comparison with the previous period exists only when that
// period is the same length and the person had already started by then.
import {
  compareMeasurements,
  estimated1RM,
  fitnessScore,
  labelNutrients,
  LABEL_NUTRIENTS,
  nutritionPeriod,
  periodBuckets,
  sessionPerformance,
  shiftDays,
  trainingProgress,
  windowDays,
  type FitnessScore,
  type FitnessScoreSession,
  type LabelNutrient,
  type LabelNutrientStats,
  type Macros,
  type MeasurementComparison,
  type NutritionDay,
  type NutritionEntry,
  type NutritionPeriod,
  type PeriodBucket,
  type ProgressSession,
  type ProgressWindow,
  type TrainingProgress,
} from "@healthapp/shared";
import type { GoalView } from "../goals-data";

// ---------- the period ----------

export const REPORT_PRESETS = [7, 30, 90, 365] as const;
export type ReportPreset = (typeof REPORT_PRESETS)[number];
/** The longest custom period a report covers (about three years): the reads stay bounded. */
export const MAX_REPORT_DAYS = 1100;

export type ReportPeriod = {
  from: string;
  to: string;
  days: number;
  preset: ReportPreset | "custom";
  /** The equally long period right before — what "vs previous" compares against. */
  previous: ProgressWindow;
};

export type ReportPeriodError = "REPORT_RANGE" | "REPORT_DATES" | "REPORT_FUTURE" | "REPORT_TOO_LONG";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
function isIsoDay(x: unknown): x is string {
  if (typeof x !== "string" || !ISO_DAY.test(x)) return false;
  const d = new Date(`${x}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === x;
}

function first(v: string | string[] | null | undefined): string | undefined {
  if (v === null || v === undefined) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

/**
 * `?range=7|30|90|365` ending today on the person's calendar, or
 * `?from=YYYY-MM-DD&to=YYYY-MM-DD` (inclusive local days). Nothing else is
 * accepted; no period defaults to the last 30 days, as the Progress page does.
 */
export function parseReportPeriod(
  raw: Record<string, string | string[] | null | undefined>,
  today: string,
): { ok: true; period: ReportPeriod } | { ok: false; code: ReportPeriodError } {
  const range = first(raw.range);
  const fromRaw = first(raw.from);
  const toRaw = first(raw.to);
  let from: string;
  let to: string;
  let preset: ReportPeriod["preset"];
  if (fromRaw !== undefined || toRaw !== undefined) {
    if (!isIsoDay(fromRaw) || !isIsoDay(toRaw) || fromRaw > toRaw) return { ok: false, code: "REPORT_DATES" };
    if (toRaw > today) return { ok: false, code: "REPORT_FUTURE" };
    from = fromRaw;
    to = toRaw;
    preset = "custom";
  } else {
    const n = range === undefined ? 30 : Number(range);
    if (!(REPORT_PRESETS as readonly number[]).includes(n)) return { ok: false, code: "REPORT_RANGE" };
    to = today;
    from = shiftDays(today, -(n - 1));
    preset = n as ReportPreset;
  }
  const days = windowDays({ start: from, end: to });
  if (days > MAX_REPORT_DAYS) return { ok: false, code: "REPORT_TOO_LONG" };
  return {
    ok: true,
    period: { from, to, days, preset, previous: { start: shiftDays(from, -days), end: shiftDays(from, -1) } },
  };
}

/** The earliest local day any read for this report needs: the previous period, or the Fitness Score's 28 days. */
export function reportReadFrom(period: ReportPeriod): string {
  const fitnessStart = shiftDays(period.to, -27);
  return period.previous.start < fitnessStart ? period.previous.start : fitnessStart;
}

// ---------- inputs ----------

/** One set as the report lists it — names already in the reader's language. */
export type ReportSet = {
  exercise_id: string | null;
  exercise_name: string;
  set_index: number;
  weight_kg: number;
  reps: number;
  duration_seconds: number | null;
  rpe: number | null;
  rir: number | null;
  is_pr: boolean;
  warmup: boolean;
};

export type ReportSession = {
  id: string;
  /** Local day (users.timezone) the session started on — the day every training figure uses. */
  day: string;
  started_at: string;
  completed_at: string;
  name: string | null;
  sets: ReportSet[];
};

export type ReportMeasurement = { day: string; weight_kg: number | null; circumferences: Record<string, number> };

export type ReportInputs = {
  period: ReportPeriod;
  /** The person's local day now, and their time zone. */
  today: string;
  timeZone: string;
  /** Completed sessions from reportReadFrom(period) to period.to, scored by toProgressSessions. */
  progressSessions: ProgressSession[];
  /** The same sessions as fitness-score-data scores them (loadOf). */
  fitnessSessions: FitnessScoreSession[];
  /** The same sessions with their sets, for the tables. */
  sessions: ReportSession[];
  /** Local day of the first completed session ever; null = never trained. */
  firstTrainingDay: string | null;
  /** Every weigh-in up to period.to (the comparison needs the first and last inside the period). */
  measurements: ReportMeasurement[];
  nutritionDays: NutritionDay[];
  /** Single entries for the label nutrients; null when that read was not complete for the period. */
  nutritionEntries: NutritionEntry[] | null;
  /**
   * Why nutritionEntries is null, so the report says it instead of passing a
   * failed read off as "too few foods carry these values". Absent = read fine.
   */
  nutritionEntriesMissing?: "failed" | "incomplete";
  nutritionFirstDay: string | null;
  /** The diary's current target; null without one. */
  nutritionTarget: Macros | null;
  /** The Goal dashboard, as of today; null when the read failed. */
  goals: GoalView[] | null;
  /** Progress photos inside the period — counted, never put in the file. */
  photosInPeriod: number | null;
  /** A read hit its row cap: the totals are a floor. */
  truncated: boolean;
};

// ---------- the report ----------

export type Unavailable = { available: false; reason: "no_data" | "not_enough_data" | "read_failed" };

export type ExerciseRow = {
  exercise_id: string;
  name: string;
  sessions: number;
  working_sets: number;
  reps: number;
  volume_kg: number;
  top_weight_kg: number;
  /** Best relevantOneRm in the period; null when no set qualifies. */
  best_1rm: number | null;
  /** First vs last session's best 1RM in the period, %; null with fewer than two qualifying sessions. */
  one_rm_change_pct: number | null;
};

export type PrRow = { day: string; exercise: string; weight_kg: number; reps: number; estimated_1rm: number };

export type SessionRow = {
  day: string;
  name: string | null;
  working_sets: number;
  volume_kg: number;
  load: number;
  duration_min: number | null;
  prs: number;
};

export type ProgressReport = {
  period: ReportPeriod;
  today: string;
  timeZone: string;
  truncated: boolean;
  summary: {
    training: TrainingProgress;
    /** False when the person had not started training before the previous period ended. */
    hasPrevious: boolean;
  };
  goals: ({ available: true; active: GoalView[] } | Unavailable);
  training: ({
    available: true;
    sessions: SessionRow[];
    /** More sessions than the PDF lists; the CSV has every one. */
    sessionsOmitted: number;
    exercises: ExerciseRow[];
    prs: PrRow[];
    buckets: { unit: "week" | "month"; items: PeriodBucket[] };
  } | Unavailable);
  fitness: ({ available: true; score: FitnessScore } | Unavailable);
  body: ({
    available: true;
    rows: ReportMeasurement[];
    /** Every circumference key recorded in the period, sorted. */
    keys: string[];
    comparison: MeasurementComparison | null;
    weightPoints: { day: string; value: number }[];
  } | Unavailable);
  photos: { count: number | null };
  nutrition: ({
    available: true;
    current: NutritionPeriod;
    previous: NutritionPeriod | null;
    target: Macros | null;
    /** Only the nutrients whose coverage is high enough to be an average (LABEL_COVERAGE_MIN). */
    labels: { key: LabelNutrient; stats: LabelNutrientStats }[];
    /** Set when the label nutrients could not be read (or not all of them) — said, never hidden. */
    labelsMissing: "failed" | "incomplete" | null;
  } | Unavailable);
};

/** Sessions listed in the PDF at most; the rest are counted and the CSV carries them. */
export const PDF_MAX_SESSION_ROWS = 120;
/** Exercises in the performance table, by working sets in the period. */
export const PDF_MAX_EXERCISES = 12;

function inPeriod(day: string, p: { from: string; to: string }): boolean {
  return day >= p.from && day <= p.to;
}

export function buildProgressReport(i: ReportInputs): ProgressReport {
  const { period } = i;
  const current: ProgressWindow = { start: period.from, end: period.to };
  const hasPrevious = i.firstTrainingDay !== null && i.firstTrainingDay <= period.previous.end;
  const training = trainingProgress(i.progressSessions, { current, previous: hasPrevious ? period.previous : null });

  return {
    period,
    today: i.today,
    timeZone: i.timeZone,
    truncated: i.truncated,
    summary: { training, hasPrevious },
    goals: i.goals === null ? { available: false, reason: "read_failed" }
      : i.goals.length === 0 ? { available: false, reason: "no_data" }
      : { available: true, active: i.goals },
    training: trainingSection(i, current),
    fitness: fitnessSection(i),
    body: bodySection(i),
    photos: { count: i.photosInPeriod },
    nutrition: nutritionSection(i, current),
  };
}

function trainingSection(i: ReportInputs, current: ProgressWindow): ProgressReport["training"] {
  const inside = i.sessions.filter((s) => inPeriod(s.day, i.period)).sort((a, b) => a.started_at.localeCompare(b.started_at));
  if (inside.length === 0) return { available: false, reason: "no_data" };
  const scored = new Map(i.progressSessions.map((s) => [s.id, s]));

  const sessionRows: SessionRow[] = inside.map((s) => {
    const perf = sessionPerformance({ session_id: s.id, day: s.day, sets: s.sets });
    const p = scored.get(s.id);
    return {
      day: s.day,
      name: s.name,
      working_sets: perf.working_sets,
      volume_kg: perf.volume_kg,
      load: p?.load ?? 0,
      duration_min: p?.duration_min ?? null,
      prs: s.sets.filter((x) => x.is_pr).length,
    };
  });

  // per exercise: the same working-set rules as the progression analysis
  const byExercise = new Map<string, { name: string; perfs: ReturnType<typeof sessionPerformance>[]; reps: number }>();
  for (const s of inside) {
    const groups = new Map<string, ReportSet[]>();
    for (const x of s.sets) {
      if (!x.exercise_id) continue;
      const list = groups.get(x.exercise_id) ?? [];
      list.push(x);
      groups.set(x.exercise_id, list);
    }
    for (const [id, sets] of groups) {
      const perf = sessionPerformance({ session_id: s.id, day: s.day, sets });
      if (perf.working_sets === 0) continue;
      const entry = byExercise.get(id) ?? { name: sets[0]!.exercise_name, perfs: [], reps: 0 };
      entry.perfs.push(perf);
      entry.reps += sets.filter((x) => !x.warmup && x.reps > 0).reduce((n, x) => n + x.reps, 0);
      byExercise.set(id, entry);
    }
  }
  const exercises: ExerciseRow[] = [...byExercise].map(([id, e]) => {
    const withOneRm = e.perfs.filter((p) => p.best_1rm !== null);
    const firstRm = withOneRm[0]?.best_1rm ?? null;
    const lastRm = withOneRm.at(-1)?.best_1rm ?? null;
    return {
      exercise_id: id,
      name: e.name,
      sessions: e.perfs.length,
      working_sets: e.perfs.reduce((n, p) => n + p.working_sets, 0),
      reps: e.reps,
      volume_kg: e.perfs.reduce((n, p) => n + p.volume_kg, 0),
      top_weight_kg: e.perfs.reduce((m, p) => Math.max(m, p.top_weight_kg), 0),
      best_1rm: withOneRm.reduce<number | null>((m, p) => (m === null || p.best_1rm! > m ? p.best_1rm : m), null),
      one_rm_change_pct: withOneRm.length >= 2 && firstRm && lastRm ? ((lastRm - firstRm) / firstRm) * 100 : null,
    };
  })
    .sort((a, b) => b.working_sets - a.working_sets || a.name.localeCompare(b.name))
    .slice(0, PDF_MAX_EXERCISES);

  const prs: PrRow[] = inside.flatMap((s) =>
    s.sets.filter((x) => x.is_pr && x.reps > 0 && x.weight_kg > 0).map((x) => ({
      day: s.day, exercise: x.exercise_name, weight_kg: x.weight_kg, reps: x.reps, estimated_1rm: estimated1RM(x.weight_kg, x.reps),
    })),
  );

  return {
    available: true,
    sessions: sessionRows.slice(-PDF_MAX_SESSION_ROWS),
    sessionsOmitted: Math.max(0, sessionRows.length - PDF_MAX_SESSION_ROWS),
    exercises,
    prs,
    buckets: periodBuckets(i.progressSessions, current),
  };
}

function fitnessSection(i: ReportInputs): ProgressReport["fitness"] {
  // The existing score for the 28 days ending on the period's last day — the
  // same function and inputs the Fitness Score page uses, with "today" moved.
  const score = fitnessScore({ sessions: i.fitnessSessions, timeZone: i.timeZone, today: i.period.to });
  if (score.status !== "active" || score.score === null) return { available: false, reason: "not_enough_data" };
  return { available: true, score };
}

function bodySection(i: ReportInputs): ProgressReport["body"] {
  const rows = i.measurements.filter((m) => inPeriod(m.day, i.period)).sort((a, b) => a.day.localeCompare(b.day));
  if (rows.length === 0) return { available: false, reason: "no_data" };
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r.circumferences)))].sort();
  const comparison = rows.length >= 2
    ? compareMeasurements(rows.map((r) => ({ day: r.day, weight_kg: r.weight_kg, circumferences: r.circumferences })), rows[0]!.day, rows.at(-1)!.day)
    : null;
  return {
    available: true,
    rows,
    keys,
    comparison,
    weightPoints: rows.filter((r) => typeof r.weight_kg === "number").map((r) => ({ day: r.day, value: r.weight_kg as number })),
  };
}

function nutritionSection(i: ReportInputs, current: ProgressWindow): ProgressReport["nutrition"] {
  const ctx = { firstDay: i.nutritionFirstDay, today: i.today };
  const now = nutritionPeriod(i.nutritionDays, current, i.nutritionTarget, ctx);
  if (now.days_logged === 0) return { available: false, reason: "no_data" };
  const started = i.nutritionFirstDay !== null && i.nutritionFirstDay <= i.period.previous.end;
  const previous = started ? nutritionPeriod(i.nutritionDays, i.period.previous, i.nutritionTarget, ctx) : null;
  const labels = i.nutritionEntries === null ? [] : (() => {
    const stats = labelNutrients(i.nutritionEntries, current);
    return LABEL_NUTRIENTS.filter((k) => stats.nutrients[k].complete).map((key) => ({ key, stats: stats.nutrients[key] }));
  })();
  return {
    available: true,
    current: now,
    previous: previous && previous.days_logged > 0 ? previous : null,
    target: i.nutritionTarget,
    labels,
    labelsMissing: i.nutritionEntries === null ? (i.nutritionEntriesMissing ?? "incomplete") : null,
  };
}
