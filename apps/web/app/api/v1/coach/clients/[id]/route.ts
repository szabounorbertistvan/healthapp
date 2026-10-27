import type { CoachClientPageV1 } from "@healthapp/api/v1";
import { apiError, apiJson, v1Route } from "@/lib/api/v1";
import { feedPost } from "@/lib/api/feed";
import { getClientGoal, getClients, getProfile } from "@/lib/data";
import { getClientGoalDashboard } from "@/lib/goals-data";
import { userCalendar } from "@/lib/my-today";
import { reportFileName } from "@/lib/reports/file-name";
import { parseReportPeriod } from "@/lib/reports/report-model";
import { getClientLiftVerdicts } from "@/lib/exercise-analytics-data";
import { getClientFitnessScore } from "@/lib/fitness-score-data";
import { getLocale } from "@/lib/i18n/server";
import { getPlan } from "@/lib/plan";
import { getFeed } from "@/lib/social-data";
import { getClientWeeklySummary, type WeekChoice } from "@/lib/weekly-data";
import { getClientRecentWorkouts } from "@/lib/workout-feedback";

// One client from the coach's side — the web's /clients/[id]: the weekly
// summary, the 28-day score and the main lifts' verdicts (Coach Pro), the last
// workouts to comment on, and the client's own posts. Every read is under RLS
// (is_active_coach_of) and computed by the same code the client's screens use.
// Coach Pro also gets the client's goals (read-only) and the progress PDF
// periods; the file itself is ./report.
export const dynamic = "force-dynamic";

export const GET = v1Route(async (request) => {
  const url = new URL(request.url);
  const id = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
  const choice: WeekChoice = url.searchParams.get("week") === "previous" ? "previous" : "current";
  const [locale, plan] = await Promise.all([getLocale(), getPlan()]);
  const lang = locale === "ro" ? "ro" : "en";
  const pro = plan.e.advancedAnalytics;
  const [clients, weekly, fitness, lifts, posts, goal, workouts, goals, calendar, me] = await Promise.all([
    getClients(),
    getClientWeeklySummary(id, choice),
    pro ? getClientFitnessScore(id) : Promise.resolve(null),
    pro ? getClientLiftVerdicts(id, lang) : Promise.resolve(null),
    getFeed({ author: id }),
    getClientGoal(id),
    getClientRecentWorkouts(id, lang),
    pro ? getClientGoalDashboard(id).catch(() => null) : Promise.resolve(null),
    pro ? userCalendar(id).catch(() => null) : Promise.resolve(null),
    getProfile(),
  ]);
  const client = clients.find((c) => c.client_id === id && c.status === "active");
  if (!client) return apiError("not_found", 404);
  return apiJson<CoachClientPageV1>({
    id,
    name: client.full_name,
    signal: client.signal,
    goal,
    analytics: pro,
    goals: goals && me ? {
      today: goals.today,
      main_goal: goals.mainGoal,
      active: goals.active,
      closed: [],
      current: goals.current,
      exercises: goals.exercises,
      kcal_target: goals.kcalTarget,
      weight_unit: me.weight_unit,
      length_unit: me.length_unit,
      max_active: null,
    } : null,
    reports: calendar ? REPORT_RANGES.flatMap((days) => {
      const parsed = parseReportPeriod({ range: String(days) }, calendar.today);
      return parsed.ok ? [{ days, file_name: reportFileName("progress", "pdf", parsed.period) }] : [];
    }) : [],
    fitness: fitness ? { current: fitness.current, previous: fitness.previous, trend: fitness.trend } : null,
    weekly,
    lifts,
    workouts,
    posts: posts.items.slice(0, 5).map(feedPost),
  });
});

/** Report periods the coach can download, in days (the web's client page). */
const REPORT_RANGES = [30, 90, 365] as const;
