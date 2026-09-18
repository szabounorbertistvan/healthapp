import { redirect } from "next/navigation";
import { getMySessions, getToday, isEmptyAccount } from "@/lib/client-data";
import { getMyChallenges } from "@/lib/challenges-data";
import { getMyWeeklySummary, type WeekChoice } from "@/lib/weekly-data";
import { getMyStreak } from "@/lib/streak-data";
import { getMyFitnessScore } from "@/lib/fitness-score-data";
import { getLeaderboard } from "@/lib/leaderboard-data";
import { hasChosenSolo } from "@/lib/onboarding";
import { getProfile } from "@/lib/data";
import { Card, EmptyState } from "@/components/ui";
import { CoachCard, HabitsCard, LinkRow, NutritionCard, TrainingCard, WeekCard } from "@/components/today-dashboard";
import { NavIcon } from "@/components/client-nav";
import { TrainingLoadSummaryCard } from "@/components/training-load";
import { StreakRow } from "@/components/streak";
import { FitnessScoreCard } from "@/components/fitness-score";
import { WeeklySummaryCard } from "@/components/weekly-summary";
import { timeAgo } from "@/lib/format";
import { parseDay } from "@/lib/week";
import { getI18n } from "@/lib/i18n/server";
import { fill } from "@/lib/i18n";
import { isoDay } from "@/lib/dates";

/**
 * Today. Three columns once there is room, one on a phone, in this order: the
 * date; the two scores (the week's, with its parts, and the 28-day fitness
 * score); one card per context — training (today's workout, the last one, the
 * streak), nutrition, habits by category, coach (check-in, feedback, unread);
 * then the community links and the weekly report folded away for whoever
 * wants the numbers.
 */
export default async function TodayPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const { t, locale } = await getI18n();
  const params = await searchParams;
  const weekChoice: WeekChoice = params.week === "previous" ? "previous" : "current";
  // The report's own week switch appends ?week=…, so any value means the
  // reader has it open — keep it open across that navigation.
  const reportOpen = params.week !== undefined;

  // Nothing to show on Today until the client has a coach or a program of their
  // own, so send a brand-new account to the choice instead of an empty screen.
  //
  // The reads are started first and the check awaited second: the check is a
  // round trip of its own, and every established account was paying it as a
  // wave in front of the whole page. A brand-new account still redirects
  // before anything is awaited; its in-flight reads are simply dropped, and the
  // detached catch keeps a rejection on that path from surfacing as unhandled.
  const reads = Promise.all([
    getToday(),
    getMyChallenges(),
    getMyWeeklySummary(weekChoice),
    getMySessions(3),
    getMyStreak(),
    getLeaderboard("training_load", "week"),
    getMyFitnessScore(),
  ]);
  reads.catch(() => {});
  // …except for a coach training themselves: /welcome asks "coach or solo",
  // a question they have already answered by being a coach, and its join-code
  // branch would only send them in a circle. getProfile is request-cached, so
  // the layout has already paid for this read.
  const me = await getProfile();
  const solo = me !== null && me.role !== "client";
  if (!solo && !(await hasChosenSolo()) && (await isEmptyAccount())) redirect("/welcome");

  const [today, challenges, weekly, recent, streakView, board, fitness] = await reads;
  if (!today) {
    return <EmptyState plain title={t.clientApp.today.notSignedInTitle} hint={t.clientApp.today.notSignedInHint} />;
  }

  const d = t.clientApp.today;
  const {
    adherence, next_workout: next, nutrition, habits, check_in: checkIn,
    sessions_done: done, sessions_planned: planned, streak_days: streak, last_activity: last,
  } = today;
  const todayIso = isoDay();
  const todayDate = parseDay(todayIso);
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "long" }).format(todayDate);
  const longDate = new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric" }).format(todayDate);
  const doneToday = recent.find((s) => s.at.slice(0, 10) === todayIso) ?? null;
  const workoutDays = today.training_load.daily.filter((x) => x.load > 0).map((x) => x.day);
  const activeChallenges = challenges.filter((c) => c.joined && c.status === "active").length;
  const nudge =
    adherence.signal === "at_risk"
      ? fill(today.has_coach ? d.atRiskBody : d.atRiskBodySolo, { time: timeAgo(last, locale) })
      : null;

  return (
    // Capped at 1600px: a dashboard of cards, three columns wide at most.
    <div className="@container mx-auto max-w-[1600px]">
      <header>
        <h1 className="font-display text-2xl font-extrabold tracking-tight first-letter:uppercase sm:text-[28px]">{weekday}</h1>
        <p className="mt-1 text-[13px] text-ink-faint first-letter:uppercase">{longDate}</p>
      </header>

      <div className="mt-4 grid grid-cols-1 items-start gap-4 sm:mt-6 @3xl:grid-cols-2 @3xl:gap-5 @6xl:grid-cols-3 @6xl:gap-6">
        {/* ---- the scores ---- */}
        {/* Two columns wide, the two scores share one row across the top; at
            three columns they stack into the first column. */}
        <div className="grid grid-cols-1 items-start gap-4 @3xl:col-span-2 @3xl:grid-cols-2 @3xl:gap-5 @6xl:order-1 @6xl:col-span-1 @6xl:grid-cols-1 @6xl:gap-6">
          <WeekCard
            adherence={adherence}
            today={todayIso}
            workoutDays={workoutDays}
            done={done}
            planned={planned}
            streak={streak}
            nudge={nudge}
            load={today.training_load}
          />

          {fitness ? <FitnessScoreCard view={fitness} /> : null}
        </div>

        {/* ---- today, one card per context ---- */}
        <div className="space-y-4 @6xl:order-2">
          <TrainingCard
            doneToday={doneToday}
            recent={recent}
            next={next}
            coached={today.has_coach}
            streak={streakView ? <StreakRow view={streakView} /> : undefined}
          />
          <NutritionCard nutrition={nutrition} />
          <HabitsCard habits={habits} />
          <CoachCard checkIn={checkIn} coached={today.has_coach} unread={today.unread_from_coach} />
        </div>

        {/* ---- everything else ---- */}
        <div className="space-y-4 @6xl:order-3">
          <Card plain className="overflow-hidden p-0">
            <p className="px-5 pt-[18px] text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{d.community}</p>
            <ul className="mt-2 divide-y divide-line/60">
              <LinkRow
                href="/leaderboards"
                icon="M4 20V10M12 20V4M20 20v-7"
                label={t.common.leaderboards.title}
                meta={board.me ? `#${board.me.rank}` : undefined}
              />
              <LinkRow
                href="/challenges"
                icon="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4"
                label={t.common.challenges.title}
                meta={`${activeChallenges} ${d.active}`}
              />
              <LinkRow href="/feed" icon="M4 5h16v11H9l-5 4z" label={t.common.social.feed} />
            </ul>
          </Card>

          <details id="weekly-report" open={reportOpen} className="group">
            <summary className="glass glass--interactive flex list-none items-center justify-between gap-3 rounded-3xl px-5 py-3.5 [&::-webkit-details-marker]:hidden">
              <span className="text-[14.5px] font-semibold">{d.weeklyReport}</span>
              <NavIcon d="m6 9 6 6 6-6" className="h-4 w-4 text-ink-faint transition-transform group-open:rotate-180" />
            </summary>
            <div className="mt-4 space-y-4">
              {weekly ? <WeeklySummaryCard summary={weekly} switchPath="/today" /> : null}
              <TrainingLoadSummaryCard summary={today.training_load} />
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}
