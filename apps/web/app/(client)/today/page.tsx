import Link from "next/link";
import { redirect } from "next/navigation";
import { getMySessions, getToday, isEmptyAccount } from "@/lib/client-data";
import { getMyChallenges } from "@/lib/challenges-data";
import { getMyWeeklySummary, type WeekChoice } from "@/lib/weekly-data";
import { getMyStreak } from "@/lib/streak-data";
import { hasChosenSolo } from "@/lib/onboarding";
import { isoDay } from "@/lib/demo-client-store";
import { Card, EmptyState } from "@/components/ui";
import { HabitTicks } from "@/components/habit-ticks";
import { NutritionTile, StatusHero, Tile, TodayWeekStrip, WorkoutRow } from "@/components/today-dashboard";
import { TrainingLoadSummaryCard } from "@/components/training-load";
import { StreakCard } from "@/components/streak";
import { WeeklySummaryCard } from "@/components/weekly-summary";
import { timeAgo } from "@/lib/format";
import { getI18n } from "@/lib/i18n/server";
import { fill } from "@/lib/i18n";

/**
 * Today, phone-first: the week on top, the mark with this week's standing,
 * the one workout that matters now, a grid of small tiles, then the detail
 * (habits, check-in, streak, weekly summary, training load) for whoever scrolls.
 */
export default async function TodayPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const { t, locale } = await getI18n();
  const weekChoice: WeekChoice = (await searchParams).week === "previous" ? "previous" : "current";

  // Nothing to show on Today until the client has a coach or a program of their
  // own, so send a brand-new account to the choice instead of an empty screen.
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
  const doneToday = recent.find((s) => s.at.slice(0, 10) === todayIso) ?? null;
  const workoutDays = today.training_load.daily.filter((x) => x.load > 0).map((x) => x.day);
  const habitsDone = habits.filter((h) => h.done_today).length;
  const activeChallenges = challenges.filter((c) => c.joined && c.status === "active").length;
  const completedChallenges = challenges.filter((c) => c.status === "completed").length;

  return (
    <div className="space-y-4">
      <TodayWeekStrip today={todayIso} workoutDays={workoutDays} />

      <StatusHero adherence={adherence} />

      {adherence.signal === "at_risk" ? (
        <p className="rounded-xl bg-risk-soft px-4 py-2.5 text-center text-xs leading-snug text-risk">
          <b>{d.atRiskTitle}</b> — {fill(d.atRiskBody, { time: timeAgo(last, locale) })}
        </p>
      ) : null}

      <WorkoutRow doneToday={doneToday} next={next} />
      <p className="text-center">
        <Link href="/workout" className="text-sm font-semibold text-accent-ink hover:underline">
          {d.viewCalendar}
        </Link>
      </p>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile href="/workout" icon="🎯" label={d.workouts} value={String(done)} unit={`/ ${planned || 3}`} done={planned > 0 && done >= planned} />
        <Tile href="/streak" icon="🔥" label={d.streak} value={String(streak)} unit={streak === 1 ? d.day : d.days} done={streak >= 7} />
        <NutritionTile totals={nutrition.totals} target={nutrition.target} />
        <div className="grid gap-3">
          <Tile href="/habits" icon="✅" label={t.common.nav.habits} value={habits.length > 0 ? `${habitsDone}/${habits.length}` : "—"} done={habits.length > 0 && habitsDone === habits.length} />
          <Tile
            href="/check-in"
            icon="📝"
            label={t.common.nav.checkIn}
            value={checkIn.submitted ? "✓" : d.due}
            unit={checkIn.submitted ? d.submitted : undefined}
            done={checkIn.submitted}
          />
        </div>
        <Tile href="/challenges" icon="🏅" label={t.common.challenges.title} value={String(activeChallenges)} unit={d.active} done={completedChallenges > 0} />
        <Tile href="/feed" icon="💬" label={t.common.social.feed}>
          <p className="mt-2 line-clamp-2 text-xs text-ink-soft">{t.common.social.emptyHint}</p>
        </Tile>
      </div>

      {habits.length > 0 ? (
        <Card>
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{d.habitsToday}</p>
          <HabitTicks habits={habits} />
        </Card>
      ) : null}

      {checkIn.last?.coach_feedback ? (
        <Card className="bg-accent-soft">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-accent-ink">{d.fromYourCoach}</p>
          <p className="mt-1 text-sm leading-snug text-ink-soft">{checkIn.last.coach_feedback}</p>
        </Card>
      ) : null}

      {streakView ? <StreakCard view={streakView} compact /> : null}

      {weekly ? <WeeklySummaryCard summary={weekly} switchPath="/today" /> : null}

      <TrainingLoadSummaryCard summary={today.training_load} />
    </div>
  );
}
