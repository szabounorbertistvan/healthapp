// Progressive overload and possible plateaus, per exercise — deterministic,
// explainable, from the person's own completed sessions.
//
// It adds no formula of its own to what the app already measures:
//   - performance of a session   relevantOneRm() (Epley, at most ONE_RM_MAX_REPS reps)
//                                from exercise-analytics — the number the exercise
//                                page charts and the strength dashboard compares
//   - volume                     setVolume(): weight × reps, exact, over working sets
//   - "previous"                 completed sessions only (the readers filter on
//                                completed_at, toAnalyticsSets repeats it)
//   - progression of a set       progressionVs() — load first, then reps
// What is new is the judgement on top: progress, stable, possible plateau,
// possible regression, or not enough data — always with the reason, the numbers
// it rests on and the window it looked at.
//
// Rules this module keeps (each has a test in exercise-progression.test.ts):
//   1. One exercise is compared with itself. The caller hands in one exercise_id's
//      sessions; a variant (dumbbell vs barbell, incline vs flat) is a different
//      library row and is never merged in here.
//   2. Warm-up sets are not performance. A set logged against a prescription whose
//      set_type is 'warmup' (program_exercises, 20260930100000) is left out; a set
//      with no prescription counts as a working set — the app has no other signal.
//   3. Invalid data never becomes a best: no reps, a timed set (reps 0), a negative
//      or absurd load, a non-integer rep count — dropped before anything is compared.
//   4. A verdict needs enough: PROGRESSION_RULES.minSessions comparable sessions over
//      at least minSpanDays, trained often enough, the latest one recent. Otherwise
//      "insufficient data", with what is missing.
//   5. One bad day is a fluctuation, not a regression: a drop must repeat in
//      regressionSessions of the last recentWindow sessions, and the recent median
//      must sit below the earlier one.
//   6. Everything is a possibility, never a diagnosis, and nothing changes the
//      program: the output is a status, reasons and a cautious suggestion to read.
//
// The thresholds are operating rules chosen for a training log, not physiology:
// they are named, documented and overridable (analyzeProgression's `rules`).
import { progressionVs, relevantOneRm, setVolume, type Progression } from "./exercise-analytics";
import { shiftDays } from "./weekly-summary";

// ---------- rules ----------

export type ProgressionRules = {
  /** Comparable sessions needed before any verdict. */
  minSessions: number;
  /** Days between the first and the last analysed session, at least. */
  minSpanDays: number;
  /** Median days between sessions above this → trained too rarely to compare. */
  maxMedianGapDays: number;
  /** The latest comparable session older than this → no verdict about "now". */
  staleDays: number;
  /** Changes within ±noisePct % of the reference are ordinary day-to-day fluctuation. */
  noisePct: number;
  /** Comparable sessions in a row without beating the last best (beyond noise)… */
  plateauSessions: number;
  /** …and at least this many days since it, before "possible plateau". */
  plateauDays: number;
  /** A session this many % under the earlier median counts as a drop. */
  regressionPct: number;
  /** Drops needed among the last recentWindow sessions for "possible regression". */
  regressionSessions: number;
  /** The "recent" sessions compared against the ones before them. */
  recentWindow: number;
  /** Sessions in a row at the top of the prescribed rep range before suggesting a small load increase. */
  repCeilingSessions: number;
  /** At most this many of the newest comparable sessions are analysed. */
  maxSessions: number;
};

export const PROGRESSION_RULES: ProgressionRules = {
  minSessions: 4,
  minSpanDays: 21,
  maxMedianGapDays: 21,
  staleDays: 42,
  noisePct: 2.5,
  plateauSessions: 4,
  plateauDays: 28,
  regressionPct: 5,
  regressionSessions: 3,
  recentWindow: 4,
  repCeilingSessions: 2,
  maxSessions: 12,
};

/** Loads above this are typing errors, not lifts (the GOAL_METRIC_SPEC lift ceiling). */
export const MAX_PLAUSIBLE_LOAD_KG = 1000;

// ---------- input ----------

export type ProgressionSet = {
  weight_kg: number;
  reps: number;
  /** Logged against a row prescribed as a warm-up. */
  warmup?: boolean;
  /** program_exercises.target_reps of the row it was logged against ("8", "8-10"); null without one. */
  target_reps?: string | null;
};

export type ProgressionSession = {
  session_id: string;
  /** Local day (the person's time zone) the session happened on. */
  day: string;
  sets: readonly ProgressionSet[];
};

/** A working set: not a warm-up, at least one whole rep, a plausible non-negative load. */
export function isWorkingSet(s: ProgressionSet): boolean {
  if (s.warmup) return false;
  if (!Number.isFinite(s.weight_kg) || !Number.isFinite(s.reps)) return false;
  if (!Number.isInteger(s.reps) || s.reps <= 0) return false;
  return s.weight_kg >= 0 && s.weight_kg <= MAX_PLAUSIBLE_LOAD_KG;
}

// ---------- one session ----------

export type SessionPerformance = {
  session_id: string;
  day: string;
  working_sets: number;
  warmup_sets: number;
  /** weight × reps over working sets, exact. */
  volume_kg: number;
  top_weight_kg: number;
  /** Most reps done at the top weight. */
  reps_at_top_weight: number;
  /** Most reps in any working set. */
  top_reps: number;
  /** Best relevantOneRm of the working sets; null when none qualifies. */
  best_1rm: number | null;
  /** The set behind best_1rm, else the heaviest. */
  best_set: { weight_kg: number; reps: number } | null;
  /** target_reps of the prescription the working sets were logged against, if any. */
  target_reps: string | null;
};

export function sessionPerformance(s: ProgressionSession): SessionPerformance {
  const working = s.sets.filter(isWorkingSet);
  let top = 0;
  let repsAtTop = 0;
  let topReps = 0;
  let volume = 0;
  let best1rm: number | null = null;
  let bestSet: { weight_kg: number; reps: number } | null = null;
  let target: string | null = null;
  for (const x of working) {
    volume += setVolume(x.weight_kg, x.reps);
    topReps = Math.max(topReps, x.reps);
    if (x.weight_kg > top) { top = x.weight_kg; repsAtTop = x.reps; }
    else if (x.weight_kg === top) repsAtTop = Math.max(repsAtTop, x.reps);
    const e = relevantOneRm(x.weight_kg, x.reps);
    if (e !== null && (best1rm === null || e > best1rm)) { best1rm = e; bestSet = { weight_kg: x.weight_kg, reps: x.reps }; }
    if (x.target_reps && !target) target = x.target_reps;
  }
  if (!bestSet && working.length > 0) bestSet = { weight_kg: top, reps: repsAtTop };
  return {
    session_id: s.session_id,
    day: s.day,
    working_sets: working.length,
    warmup_sets: s.sets.filter((x) => x.warmup).length,
    volume_kg: volume,
    top_weight_kg: top,
    reps_at_top_weight: repsAtTop,
    top_reps: topReps,
    best_1rm: best1rm,
    best_set: bestSet,
    target_reps: target,
  };
}

// ---------- the verdict ----------

/**
 * What a session's performance is measured with:
 *   one_rm    the best estimated 1RM (loaded sets of ≤ 12 reps) — the default
 *   best_set  weight × reps of the best single set, for loaded work done only in
 *             sets past 12 reps, where Epley stops describing a max
 *   reps      the most reps in one set, for an exercise never done with load
 */
export type ProgressionMetric = "one_rm" | "best_set" | "reps";

export type ProgressionStatus = "progress" | "stable" | "plateau" | "regression" | "insufficient";

export type InsufficientReason = "too_few_sessions" | "too_short_period" | "too_infrequent" | "no_recent_sessions";

export type ProgressionReason =
  | { code: "new_best"; sessions_ago: number; change_pct: number }
  | { code: "within_band"; sessions: number; band_pct: number }
  | { code: "no_new_best"; sessions: number; days: number }
  | { code: "repeated_drop"; drops: number; of: number; drop_pct: number }
  | { code: "isolated_dip"; drops: number; of: number }
  | { code: InsufficientReason; have: number; need: number };

export type ProgressionSuggestion =
  | "keep_going"
  | "consider_small_increase"
  | "review_progression"
  | "check_consistency_recovery"
  | "check_volume_technique_recovery"
  | "keep_logging";

export type SessionComparison = {
  from: SessionPerformance;
  to: SessionPerformance;
  /** The top working set of each, compared load first (progressionVs). */
  top_set: Progression | null;
  volume_delta_kg: number;
  sets_delta: number;
  /** Difference of the performance metric, in its unit. */
  performance_delta: number | null;
};

export type PeriodDays = 7 | 30 | 90 | 365 | null;
export const PROGRESSION_PERIODS: readonly PeriodDays[] = [7, 30, 90, 365, null];

export type PeriodChangeRow = {
  days: PeriodDays;
  sessions: number;
  /** First and last comparable session's performance in the period; null with fewer than two sessions. */
  first: number | null;
  last: number | null;
  change_pct: number | null;
  volume_change_pct: number | null;
};

export type ProgressionAnalysis = {
  status: ProgressionStatus;
  metric: ProgressionMetric;
  reasons: ProgressionReason[];
  suggestion: ProgressionSuggestion;
  /** Comparable sessions analysed, and the days they span. */
  sessions_analyzed: number;
  from_day: string | null;
  to_day: string | null;
  /** Newest comparable session and the best one in the window. */
  latest: SessionPerformance | null;
  best: SessionPerformance | null;
  /** The newest comparable session against the one before it. */
  comparison: SessionComparison | null;
  /** Median of the last recentWindow sessions vs the ones before them, %; null without both. */
  recent_change_pct: number | null;
  /** Last third vs first third of the window, %; null under six sessions. */
  long_change_pct: number | null;
  periods: PeriodChangeRow[];
  /** Every analysed session's performance, oldest first — the points the verdict rests on. */
  series: { day: string; value: number }[];
  /** Working sets left out as warm-ups across the window (shown so the exclusion is visible). */
  warmups_excluded: number;
  rules: ProgressionRules;
};

function median(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function pct(from: number | null, to: number | null): number | null {
  if (from === null || to === null || !(from > 0)) return null;
  return ((to - from) / from) * 100;
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

function performanceOf(p: SessionPerformance, metric: ProgressionMetric): number | null {
  if (p.working_sets === 0) return null;
  if (metric === "one_rm") return p.best_1rm;
  if (metric === "reps") return p.top_reps > 0 ? p.top_reps : null;
  return p.best_set && p.best_set.weight_kg > 0 ? p.best_set.weight_kg * p.best_set.reps : null;
}

/** Pick the metric the history can carry: 1RM if enough sessions have one, then best set, then reps. */
function chooseMetric(perfs: readonly SessionPerformance[], rules: ProgressionRules): ProgressionMetric {
  const withOneRm = perfs.filter((p) => p.best_1rm !== null).length;
  if (withOneRm >= Math.min(rules.minSessions, perfs.length) && withOneRm > 0) return "one_rm";
  const loaded = perfs.some((p) => p.top_weight_kg > 0);
  return loaded ? "best_set" : "reps";
}

/** The upper end of a prescribed rep range: "8-10" → 10, "8" → 8, anything else → null. */
export function repCeiling(target: string | null | undefined): number | null {
  if (!target) return null;
  const m = /^\s*(\d{1,3})\s*(?:[-–]\s*(\d{1,3}))?\s*$/.exec(target);
  if (!m) return null;
  const hi = Number(m[2] ?? m[1]);
  return hi > 0 ? hi : null;
}

/**
 * True when the last `n` comparable sessions were done at one top load and
 * every working set at that load reached the top of the prescribed range —
 * the point where a program built on a rep range usually asks for more load.
 */
export function atRepCeiling(perfs: readonly SessionPerformance[], sessions: readonly ProgressionSession[], n: number): boolean {
  const lastPerfs = perfs.slice(-n);
  if (lastPerfs.length < n) return false;
  const load = lastPerfs[0]!.top_weight_kg;
  if (!(load > 0) || lastPerfs.some((p) => Math.abs(p.top_weight_kg - load) > 0.005)) return false;
  const byId = new Map(sessions.map((s) => [s.session_id, s]));
  for (const p of lastPerfs) {
    const ceiling = repCeiling(p.target_reps);
    if (ceiling === null) return false;
    const atLoad = (byId.get(p.session_id)?.sets ?? []).filter((x) => isWorkingSet(x) && Math.abs(x.weight_kg - load) <= 0.005);
    if (atLoad.length === 0 || atLoad.some((x) => x.reps < ceiling)) return false;
  }
  return true;
}

function compare(from: SessionPerformance, to: SessionPerformance, metric: ProgressionMetric): SessionComparison {
  const a = performanceOf(from, metric);
  const b = performanceOf(to, metric);
  return {
    from,
    to,
    top_set: progressionVs(
      { weight_kg: to.top_weight_kg, reps: to.reps_at_top_weight },
      { weight_kg: from.top_weight_kg, reps: from.reps_at_top_weight },
    ),
    volume_delta_kg: to.volume_kg - from.volume_kg,
    sets_delta: to.working_sets - from.working_sets,
    performance_delta: a !== null && b !== null ? b - a : null,
  };
}

function periodRows(perfs: readonly SessionPerformance[], metric: ProgressionMetric, today: string): PeriodChangeRow[] {
  return PROGRESSION_PERIODS.map((days) => {
    const from = days === null ? null : shiftDays(today, -(days - 1));
    const inWindow = perfs.filter((p) => (from === null || p.day >= from) && p.day <= today && performanceOf(p, metric) !== null);
    if (inWindow.length < 2) {
      return { days, sessions: inWindow.length, first: null, last: null, change_pct: null, volume_change_pct: null };
    }
    const first = inWindow[0]!;
    const last = inWindow[inWindow.length - 1]!;
    const f = performanceOf(first, metric);
    const l = performanceOf(last, metric);
    return {
      days,
      sessions: inWindow.length,
      first: f,
      last: l,
      change_pct: pct(f, l),
      volume_change_pct: pct(first.volume_kg, last.volume_kg),
    };
  });
}

/**
 * The analysis for one exercise. `sessions` are that exercise's completed
 * sessions, in any order; `today` is the person's local day.
 */
export function analyzeProgression(
  sessions: readonly ProgressionSession[],
  today: string,
  overrides: Partial<ProgressionRules> = {},
): ProgressionAnalysis {
  const rules: ProgressionRules = { ...PROGRESSION_RULES, ...overrides };
  const all = [...sessions]
    .filter((s) => s.day <= today)
    .sort((a, b) => a.day.localeCompare(b.day) || a.session_id.localeCompare(b.session_id))
    .map(sessionPerformance)
    .filter((p) => p.working_sets > 0);
  const metric = chooseMetric(all, rules);
  const comparable = all.filter((p) => performanceOf(p, metric) !== null);
  const window = comparable.slice(-rules.maxSessions);
  const values = window.map((p) => performanceOf(p, metric)!);
  const series = window.map((p, i) => ({ day: p.day, value: values[i]! }));
  const latest = window.at(-1) ?? null;
  const best = window.reduce<SessionPerformance | null>((b, p, i) => (b === null || values[i]! > performanceOf(b, metric)! ? p : b), null);
  const warmups = sessions.filter((s) => s.day <= today).reduce((n, s) => n + s.sets.filter((x) => x.warmup).length, 0);

  const recent = values.slice(-rules.recentWindow);
  const before = values.slice(0, Math.max(0, values.length - rules.recentWindow));
  const third = Math.floor(values.length / 3);
  const base = {
    metric,
    sessions_analyzed: window.length,
    from_day: window[0]?.day ?? null,
    to_day: latest?.day ?? null,
    latest,
    best,
    comparison: window.length >= 2 ? compare(window.at(-2)!, window.at(-1)!, metric) : null,
    recent_change_pct: before.length >= 2 ? pct(median(before), median(recent)) : null,
    long_change_pct: values.length >= 6 ? pct(median(values.slice(0, third)), median(values.slice(-third))) : null,
    periods: periodRows(comparable, metric, today),
    series,
    warmups_excluded: warmups,
    rules,
  };
  const insufficient = (reason: ProgressionReason): ProgressionAnalysis =>
    ({ ...base, status: "insufficient", reasons: [reason], suggestion: "keep_logging" });

  // ---- 4. enough to say anything? ----
  if (window.length < rules.minSessions) {
    return insufficient({ code: "too_few_sessions", have: window.length, need: rules.minSessions });
  }
  const sinceLatest = daysBetween(latest!.day, today);
  if (sinceLatest > rules.staleDays) {
    return insufficient({ code: "no_recent_sessions", have: sinceLatest, need: rules.staleDays });
  }
  const span = daysBetween(window[0]!.day, latest!.day);
  if (span < rules.minSpanDays) {
    return insufficient({ code: "too_short_period", have: span, need: rules.minSpanDays });
  }
  const gaps = window.slice(1).map((p, i) => daysBetween(window[i]!.day, p.day));
  const medianGap = median(gaps) ?? 0;
  if (medianGap > rules.maxMedianGapDays) {
    return insufficient({ code: "too_infrequent", have: Math.round(medianGap), need: rules.maxMedianGapDays });
  }

  const noise = rules.noisePct / 100;

  // ---- 5. a repeated drop, not a bad day ----
  const ref = median(before);
  const dropLine = ref === null ? null : ref * (1 - rules.regressionPct / 100);
  const drops = dropLine === null ? 0 : recent.filter((v) => v < dropLine).length;
  if (ref !== null && before.length >= 2 && drops >= rules.regressionSessions && median(recent)! < dropLine!) {
    return {
      ...base,
      status: "regression",
      reasons: [{ code: "repeated_drop", drops, of: recent.length, drop_pct: Math.abs(pct(ref, median(recent)) ?? 0) }],
      suggestion: "check_volume_technique_recovery",
    };
  }

  // ---- the last real improvement: beating the previous best by more than the noise ----
  let anchor = values[0]!;
  let lastImprovement = 0;
  let lastGain = 0;
  for (let i = 1; i < values.length; i++) {
    if (values[i]! > anchor * (1 + noise)) {
      lastGain = pct(anchor, values[i]!) ?? 0;
      anchor = values[i]!;
      lastImprovement = i;
    }
  }
  const sessionsSince = values.length - 1 - lastImprovement;
  const daysSince = daysBetween(window[lastImprovement]!.day, today);
  const ceiling = atRepCeiling(window, sessions, rules.repCeilingSessions);
  const extra: ProgressionReason[] = drops > 0 ? [{ code: "isolated_dip", drops, of: recent.length }] : [];

  if (lastImprovement > 0 && sessionsSince < rules.plateauSessions) {
    return {
      ...base,
      status: "progress",
      reasons: [{ code: "new_best", sessions_ago: sessionsSince, change_pct: lastGain }, ...extra],
      suggestion: ceiling ? "consider_small_increase" : "keep_going",
    };
  }
  if (sessionsSince >= rules.plateauSessions && daysSince >= rules.plateauDays) {
    return {
      ...base,
      status: "plateau",
      reasons: [{ code: "no_new_best", sessions: sessionsSince, days: daysSince }, ...extra],
      suggestion: ceiling ? "consider_small_increase" : "check_consistency_recovery",
    };
  }
  return {
    ...base,
    status: "stable",
    reasons: [{ code: "within_band", sessions: values.length, band_pct: rules.noisePct }, ...extra],
    suggestion: ceiling ? "consider_small_increase" : "review_progression",
  };
}
