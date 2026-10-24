import type { ProgressOverviewV1 } from "@healthapp/api/v1";
import {
  bodyProgress, calendarWeekWorkouts, periodBuckets, progressInsights, progressWindows, strengthHighlights, trainingProgress,
} from "@healthapp/shared";
import { apiError, apiJson, v1Route } from "@/lib/api/v1";
import { getMyMeasurements, getMyProgramDays, getMyPrs, getMySessions } from "@/lib/client-data";
import { getProfile } from "@/lib/data";
import { getMyFitnessScore } from "@/lib/fitness-score-data";
import { timeAgo } from "@/lib/format";
import { getI18n } from "@/lib/i18n/server";
import { getPlan, inHistory } from "@/lib/plan";
import { getMyProgressTraining } from "@/lib/progress-data";
import { parseProgressParams } from "@/lib/progress-params";
import { getMyStreak } from "@/lib/streak-data";

// The app's Progress: what app/(client)/progress/page.tsx folds on the server
// for its headline, insights and the Body, Strength and Consistency tabs — the
// same reads and the same packages/shared functions, in one wave. The plan
// gates exactly what the page gates (charts, the PR list, the history window).
export const dynamic = "force-dynamic";

/** As the page: far past anyone's weigh-in count, but bounded. */
const MEASUREMENT_HISTORY = 500;
/** Personal records a plan without progress charts lists. */
const FREE_PRS_SHOWN = 3;

export const GET = v1Route(async (request) => {
  const state = parseProgressParams(Object.fromEntries(new URL(request.url).searchParams));
  const [{ locale }, profile, plan, allMeasurements, allPrs, sessions, training, fitness, streak, programDays] = await Promise.all([
    getI18n(),
    getProfile(),
    getPlan(),
    getMyMeasurements(MEASUREMENT_HISTORY),
    getMyPrs(),
    getMySessions(200),
    getMyProgressTraining(state.range),
    getMyFitnessScore().catch(() => null),
    getMyStreak(),
    getMyProgramDays(),
  ]);
  if (!training || !profile) return apiError("not_found", 404);

  const measurements = allMeasurements.filter((m) => inHistory(plan, m.taken_on));
  const charts = plan.e.progressCharts;
  const prs = charts ? allPrs : allPrs.slice(0, FREE_PRS_SHOWN);

  const firstMeasurement = allMeasurements[0]?.taken_on ?? null;
  const earliest =
    training.firstDay && firstMeasurement
      ? training.firstDay < firstMeasurement ? training.firstDay : firstMeasurement
      : (training.firstDay ?? firstMeasurement);
  const windows = progressWindows(training.today, state.range, earliest);
  const body = bodyProgress(
    allMeasurements.map((m) => ({ day: m.taken_on, weight_kg: m.weight_kg, circumferences: m.circumferences })),
    windows,
  );
  const trainingNow = trainingProgress(training.sessions, windows);
  const highlights = strengthHighlights(training.sessions, windows);
  const thisWeek = calendarWeekWorkouts(training.sessions, training.today);
  const insights = progressInsights({
    training: trainingNow,
    strength: highlights,
    body,
    week: state.range === 7 ? null : thisWeek,
  });
  const names: Record<string, string> = {};
  for (const pr of allPrs) if (pr.exercise_id) names[pr.exercise_id] = pr.exercise;
  const trend = fitness?.trend;

  return apiJson<ProgressOverviewV1>({
    range: state.range,
    has_previous: windows.previous !== null,
    truncated: training.truncated,
    weight_unit: profile.weight_unit,
    length_unit: profile.length_unit,
    charts,
    stats: {
      current_weight_kg: body.weight.latest?.value ?? null,
      sessions: sessions.length,
      total_volume_kg: sessions.reduce((sum, s) => sum + s.volume_exact_kg, 0),
      prs: allPrs.length,
    },
    insights,
    names,
    body,
    measurements: [...measurements].reverse().map((m) => ({ id: m.id, taken_on: m.taken_on, weight_kg: m.weight_kg, waist_cm: m.waist_cm })),
    history_capped: measurements.length < allMeasurements.length,
    training: trainingNow,
    highlights,
    buckets: periodBuckets(training.sessions, windows.current),
    fitness: fitness
      ? {
          score: fitness.current.score,
          trend:
            charts && trend && trend.delta !== null && trend.current !== null && trend.previous !== null
              ? { current: trend.current, previous: trend.previous, delta: trend.delta }
              : null,
        }
      : null,
    prs: prs.map((p) => ({ exercise: p.exercise, exercise_id: p.exercise_id ?? null, best_kg: p.best, ago: timeAgo(p.at, locale) })),
    prs_hidden: allPrs.length - prs.length,
    this_week: thisWeek.current,
    streak: streak ? { current: streak.summary.current, longest: streak.summary.longest } : null,
    planned_per_week: programDays && programDays.length > 0 ? programDays.length : null,
  });
});
