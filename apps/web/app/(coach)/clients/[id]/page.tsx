import Link from "next/link";
import { notFound } from "next/navigation";
import { getCoachClientRelationships } from "@/lib/coaching-data";
import { getClientGoal, getClients } from "@/lib/data";
import { getClientWeeklySummary, type WeekChoice } from "@/lib/weekly-data";
import { getClientFitnessScore } from "@/lib/fitness-score-data";
import { getClientGoalDashboard } from "@/lib/goals-data";
import { getClientLiftVerdicts } from "@/lib/exercise-analytics-data";
import { userCalendar } from "@/lib/my-today";
import { reportFileName } from "@/lib/reports/file-name";
import { parseReportPeriod } from "@/lib/reports/report-model";
import { ClientGoalsCard } from "@/components/goals";
import { ProgressionOverview } from "@/components/exercise-progression";
import { ClientReportDownload, type ClientReportOption } from "@/components/client-report-download";
import { getFeed } from "@/lib/social-data";
import { getClientRecentWorkouts } from "@/lib/workout-feedback";
import { ClientWorkoutsFeedback } from "@/components/workout-feedback";
import { SignalBadge } from "@/components/ui";
import { NavIcon } from "@/components/client-nav";
import { WeeklySummaryCard } from "@/components/weekly-summary";
import { FitnessScoreCoachCard } from "@/components/fitness-score";
import { PostCard } from "@/components/social";
import { Card } from "@/components/ui";
import { fill } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import { getPlan } from "@/lib/plan";
import { PremiumSoon, UpgradeHint } from "@/components/upgrade";

/**
 * One client, from the coach's side: their weekly summary, 28-day fitness
 * score, measurable goals, main-lift progression and progress report. Every
 * number is read under RLS — a coach sees exactly what is_active_coach_of()
 * allows — and computed by the same code the client's own screens use, on the
 * client's calendar. Nothing here writes the client's goals.
 */
export default async function CoachClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ week?: string }>;
}) {
  const { t, locale } = await getI18n();
  const [{ id }, { week }] = await Promise.all([params, searchParams]);
  const choice: WeekChoice = week === "previous" ? "previous" : "current";
  // The roster and the summary go out together: the summary is filtered by
  // client id and RLS answers it, so it never needed the roster first. A client
  // the coach cannot see still 404s below — the wasted summary read is empty.
  const [clients, summary, fitness, insights, posts, relationships, goal, workouts] = await Promise.all([
    getClients(),
    getClientWeeklySummary(id, choice),
    // Coach Pro. getPlan is request-cached off the layout's profile read.
    getPlan().then((plan) => (plan.e.advancedAnalytics ? getClientFitnessScore(id) : null)),
    // Coach Pro too: the client's measurable goals, their main lifts' verdicts
    // and the client's calendar for the report periods — read-only, under RLS
    // (goals_coach_read, the session/set/measurement coach policies,
    // client_food_daily_totals), on the client's own calendar.
    getPlan().then((plan) => (plan.e.advancedAnalytics ? clientInsights(id, locale === "ro" ? "ro" : "en") : null)),
    // What the client chose to put out themselves. Since 20260921100000 an
    // active coach passes the 'followers' branch, so this is the coach's view
    // of the same cards the client's followers see — private posts excluded.
    getFeed({ author: id }),
    // the relationship itself, for its lifecycle actions (20261109110000)
    getCoachClientRelationships("current"),
    // the goal the client picked in their setup steps (goals_coach_read)
    getClientGoal(id),
    // their last finished workouts, set by set, to comment on (20261207110000)
    getClientRecentWorkouts(id, locale === "ro" ? "ro" : "en"),
  ]);
  const relationship = relationships.find((r) => r.client_id === id && r.status === "active") ?? null;
  const plan = await getPlan();
  const client = clients.find((c) => c.client_id === id && c.status === "active");
  if (!client) notFound();

  return (
    // One client's report: a readable column, not the full desk width.
    <div className="mx-auto max-w-3xl">
      <Link
        href="/clients"
        className="inline-flex h-9 items-center gap-1.5 rounded-full bg-surface px-3.5 text-[12.5px] font-semibold text-ink-soft hover:text-ink"
      >
        <NavIcon d={ICON.back} className="h-[15px] w-[15px]" />
        {t.common.nav.clients}
      </Link>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <h1 className="font-display text-2xl font-extrabold leading-none tracking-tight sm:text-[28px]">
            {client.full_name}
          </h1>
          {plan.e.advancedAnalytics ? <SignalBadge signal={client.signal} /> : null}
          {relationship ? (
            <Link href={`/clients/relationship/${relationship.id}`} className="text-[12.5px] font-semibold text-ink-faint hover:text-ink" data-testid="client-relationship-link">
              {t.coachProfile.coaching.history} →
            </Link>
          ) : null}
        </div>
        {/* The roster page has a generic "new program" button with a client
            picker; from here the client is already known, so it rides on the
            query string and the form opens with them selected. */}
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/programs/new?client=${id}`}
            className="inline-flex h-11 items-center justify-center rounded-2xl bg-accent px-5 font-display text-sm font-bold text-accent-fg hover:opacity-90"
          >
            {t.coachApp.programs.newProgram}
          </Link>
          <Link
            href={`/nutrition/new?client=${id}`}
            className="inline-flex h-11 items-center justify-center rounded-2xl bg-surface px-5 text-[13px] font-semibold text-ink-soft hover:text-ink"
          >
            {t.coachApp.nutrition.newPlan}
          </Link>
        </div>
      </div>
      {goal ? (
        <p className="mt-3 text-[13.5px] text-ink-soft" data-testid="client-goal">
          <span className="font-semibold text-ink">{t.onboarding.coachView.goal}</span> {goal}
        </p>
      ) : null}

      <div className="mt-4 space-y-4 sm:mt-6">
        {plan.e.advancedAnalytics ? <PremiumSoon feature="advancedAnalytics" /> : null}
        {fitness ? (
          <FitnessScoreCoachCard view={fitness} />
        ) : !plan.e.advancedAnalytics ? (
          <UpgradeHint card feature="clientScore" upgrade={plan.upgrade} />
        ) : null}
        {summary ? (
          <WeeklySummaryCard summary={summary} switchPath={`/clients/${id}`} />
        ) : (
          <p className="text-[13px] text-ink-faint">{t.common.weekly.noData}</p>
        )}

        {insights ? (
          <>
            {insights.goals ? <ClientGoalsCard dashboard={insights.goals} name={client.full_name} /> : null}
            <ProgressionOverview items={insights.lifts} forCoach />
            <ClientReportDownload name={client.full_name} options={insights.reports} />
          </>
        ) : null}

        <ClientWorkoutsFeedback clientId={id} sessions={workouts} name={client.full_name} />

        <section>
          <h2 className="mb-3 font-display text-lg font-bold tracking-tight">
            {fill(t.coachApp.clients.postsTitle, { name: client.full_name })}
          </h2>
          {posts.items.length === 0 ? (
            <Card plain>
              <p className="text-[13px] text-ink-faint">{t.coachApp.clients.postsEmpty}</p>
            </Card>
          ) : (
            <div className="space-y-3.5">
              {posts.items.slice(0, 5).map((post) => (
                <PostCard key={post.id} post={post} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/** Report periods the coach can download, in days. */
const REPORT_RANGES = [30, 90, 365] as const;

/**
 * The client's goals, main-lift verdicts and report periods, in one wave. A
 * failed goals read hides that section (and is logged) rather than taking the
 * whole client page down; a failed lift read already comes back empty.
 */
async function clientInsights(clientId: string, locale: "ro" | "en") {
  const [goals, lifts, calendar] = await Promise.all([
    getClientGoalDashboard(clientId).catch((e: unknown) => {
      console.error(`[clients] goals for coach view: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }),
    getClientLiftVerdicts(clientId, locale),
    userCalendar(clientId),
  ]);
  const reports: ClientReportOption[] = REPORT_RANGES.flatMap((days) => {
    const parsed = parseReportPeriod({ range: String(days) }, calendar.today);
    return parsed.ok
      ? [{ days, url: `/api/clients/${clientId}/report?range=${days}`, fileName: reportFileName("progress", "pdf", parsed.period) }]
      : [];
  });
  return { goals, lifts, reports };
}

/** The 24-box icon paths this screen uses. */
const ICON = {
  back: "m15 6-6 6 6 6",
} as const;
