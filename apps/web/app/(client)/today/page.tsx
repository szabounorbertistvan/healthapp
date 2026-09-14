import { redirect } from "next/navigation";
import { getMySessions, getToday, isEmptyAccount } from "@/lib/client-data";
import { getMyChallenges } from "@/lib/challenges-data";
import { getMyWeeklySummary, type WeekChoice } from "@/lib/weekly-data";
import { getMyStreak } from "@/lib/streak-data";
import { hasChosenSolo } from "@/lib/onboarding";
import { Card, EmptyState } from "@/components/ui";
import { LinkRow, TodayChecklist, WeekCard } from "@/components/today-dashboard";
import { TrainingLoadSummaryCard } from "@/components/training-load";
import { StreakCard } from "@/components/streak";
import { WeeklySummaryCard } from "@/components/weekly-summary";
import { timeAgo } from "@/lib/format";
import { parseDay } from "@/lib/week";
import { getI18n } from "@/lib/i18n/server";
import { fill } from "@/lib/i18n";
import { isoDay } from "@/lib/dates";

/**
 * Today, phone-first, top to bottom: the date, today's checklist (the one
 * card that answers "what do I do now"), a word from the coach, the week's
 * score with its parts, the workout streak, links to the rest, and the weekly
 * report folded away for whoever wants the numbers.
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
  // This stays in front of the reads below rather than racing them. Running it
  // alongside would save two round trips for an established account, but it
  // would also mean a brand-new account fetches its whole Today screen before
  // being sent away from it — wasted at best, and a 500 instead of a clean
  // redirect if any of those reads dislikes an account with nothing in it.
  // The reads below are one wave now, so two round trips is a small share of
  // the page, and this is the cheap half of the trade.
  if (!(await hasChosenSolo()) && (await isEmptyAccount())) redirect("/welcome");

  const [today, challenges, weekly, recent, streakView] = await Promise.all([
    getToday(),
    getMyChallenges(),
    getMyWeeklySummary(weekChoice),
    getMySessions(3),
    getMyStreak(),
  ]);
  if (!today) {
    return <EmptyState title={t.clientApp.today.notSignedInTitle} hint={t.clientApp.today.notSignedInHint} />;
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
  const nudge = adherence.signal === "at_risk" ? fill(d.atRiskBody, { time: timeAgo(last, locale) }) : null;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <header>
        <h1 className="text-xl font-bold tracking-tight first-letter:uppercase">{weekday}</h1>
        <p className="text-sm text-ink-faint first-letter:uppercase">{longDate}</p>
      </header>

      <TodayChecklist doneToday={doneToday} next={next} nutrition={nutrition} habits={habits} checkIn={checkIn} />

      {checkIn.last?.coach_feedback ? (
        <Card className="bg-accent-soft">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-accent-ink">{d.fromYourCoach}</p>
          <p className="mt-1 text-sm leading-snug text-ink-soft">{checkIn.last.coach_feedback}</p>
        </Card>
      ) : null}

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

      {streakView ? <StreakCard view={streakView} compact /> : null}

      <Card className="overflow-hidden p-0">
        <ul className="divide-y divide-line">
          <LinkRow href="/challenges" icon="🏅" label={t.common.challenges.title} meta={`${activeChallenges} ${d.active}`} />
          <LinkRow href="/feed" icon="💬" label={t.common.social.feed} />
        </ul>
      </Card>

      <details id="weekly-report" open={reportOpen} className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3 hover:border-accent [&::-webkit-details-marker]:hidden">
          <span className="text-sm font-semibold">{d.weeklyReport}</span>
          <span className="text-ink-faint transition-transform group-open:rotate-180" aria-hidden>▾</span>
        </summary>
        <div className="mt-4 space-y-4">
          {weekly ? <WeeklySummaryCard summary={weekly} switchPath="/today" /> : null}
          <TrainingLoadSummaryCard summary={today.training_load} />
        </div>
      </details>
    </div>
  );
}
