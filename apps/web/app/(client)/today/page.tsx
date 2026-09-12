import Link from "next/link";
import { redirect } from "next/navigation";
import { getToday, isEmptyAccount } from "@/lib/client-data";
import { getMyChallenges } from "@/lib/challenges-data";
import { hasChosenSolo } from "@/lib/onboarding";
import { Card, EmptyState, PageTitle, SignalBadge } from "@/components/ui";
import { AdherenceMeter, MacroPanel } from "@/components/client-ui";
import { HabitTicks } from "@/components/habit-ticks";
import { TrainingLoadSummaryCard } from "@/components/training-load";
import { timeAgo } from "@/lib/format";
import { getI18n } from "@/lib/i18n/server";
import { fill } from "@/lib/i18n";

export default async function TodayPage() {
  const { t, locale } = await getI18n();

  // Nothing to show on Today until the client has a coach or a program of their
  // own, so send a brand-new account to the choice instead of an empty screen.
  // The moment either path is taken this stops firing — including picking
  // "I train on my own" without finishing a program (see chooseSoloTraining).
  if (!(await hasChosenSolo()) && (await isEmptyAccount())) redirect("/welcome");

  const [today, challenges] = await Promise.all([getToday(), getMyChallenges()]);
  if (!today) {
    return (
      <EmptyState
        title={t.clientApp.today.notSignedInTitle}
        hint={t.clientApp.today.notSignedInHint}
      />
    );
  }

  const {
    adherence, next_workout: next, nutrition, habits, check_in: checkIn,
    sessions_done: done, sessions_planned: planned, streak_days: streak, last_activity: last,
  } = today;

  return (
    <div className="space-y-4">
      <PageTitle title={fill(t.clientApp.today.hi, { name: today.full_name.split(" ")[0] })}>
        <SignalBadge signal={adherence.signal} />
      </PageTitle>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <AdherenceMeter overall={adherence.overall} reason={adherence.reason} />
        </Card>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-1">
          <Card>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
              {t.clientApp.today.streak}
            </p>
            <p className="mt-1 text-2xl font-bold tabular-nums">
              {streak}
              <span className="ml-1 text-sm font-medium text-ink-faint">
                {streak === 1 ? t.clientApp.today.day : t.clientApp.today.days}
              </span>
            </p>
          </Card>
          <Card>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
              {t.clientApp.today.workouts}
            </p>
            <p className="mt-1 text-2xl font-bold tabular-nums">
              {done}
              <span className="text-sm font-medium text-ink-faint"> / {planned || 3}</span>
            </p>
          </Card>
        </div>
      </div>

      <TrainingLoadSummaryCard summary={today.training_load} />

      {/* Challenges live off the tab bar, so Today carries the way in. */}
      <Link href="/challenges" className="block">
        <Card className="flex items-center justify-between gap-3 hover:border-accent">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
              {t.common.challenges.title}
            </p>
            <p className="mt-1 truncate text-sm text-ink-soft">
              {challenges.some((c) => c.joined)
                ? fill(t.common.challenges.onToday, {
                    active: challenges.filter((c) => c.joined && c.status === "active").length,
                    completed: challenges.filter((c) => c.status === "completed").length,
                  })
                : t.common.challenges.onTodayNone}
            </p>
          </div>
          <span className="shrink-0 text-lg text-ink-faint">›</span>
        </Card>
      </Link>

      {adherence.signal === "at_risk" ? (
        <Card className="border-risk-soft bg-risk-soft">
          <p className="text-sm font-semibold text-risk">{t.clientApp.today.atRiskTitle}</p>
          <p className="mt-1 text-xs leading-snug text-risk">
            {fill(t.clientApp.today.atRiskBody, { time: timeAgo(last, locale) })}
          </p>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            {t.clientApp.today.nextWorkout}
          </p>
          {next ? (
            <>
              <p className="font-bold">{next.day_name}</p>
              <p className="mt-0.5 text-xs text-ink-faint">
                {next.program_name} · {fill(t.clientApp.workout.exercisesCount, { count: next.exercises.length })}
              </p>
              <ul className="mt-3 space-y-1 text-sm text-ink-soft">
                {next.exercises.slice(0, 3).map((e) => (
                  <li key={e.id} className="flex justify-between gap-2">
                    <span className="truncate">{e.exercise}</span>
                    <span className="shrink-0 tabular-nums text-ink-faint">
                      {e.sets}×{e.reps}
                    </span>
                  </li>
                ))}
                {next.exercises.length > 3 ? (
                  <li className="text-xs text-ink-faint">
                    {fill(t.clientApp.workout.moreExercises, { count: next.exercises.length - 3 })}
                  </li>
                ) : null}
              </ul>
              <Link
                href={`/workout/${next.day_id}/log`}
                className="mt-4 inline-block rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg hover:opacity-90"
              >
                {t.clientApp.today.startWorkout}
              </Link>
            </>
          ) : (
            <p className="text-sm text-ink-soft">{t.clientApp.today.noProgram}</p>
          )}
        </Card>

        <div className="space-y-4">
          <MacroPanel
            totals={nutrition.totals}
            target={nutrition.target}
            title={nutrition.plan_name ?? t.common.nav.nutrition}
          />
          <Link
            href="/food"
            className="inline-block rounded-lg border border-line px-4 py-2 text-sm font-semibold hover:border-accent"
          >
            {t.clientApp.today.logFood}
          </Link>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            {t.clientApp.today.habitsToday}
          </p>
          {habits.length === 0 ? (
            <p className="text-sm text-ink-soft">{t.clientApp.today.noHabitsYet}</p>
          ) : (
            <HabitTicks habits={habits} />
          )}
        </Card>

        <Card>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            {t.clientApp.today.weeklyCheckIn}
          </p>
          {checkIn.submitted ? (
            <p className="text-sm text-ink-soft">{t.clientApp.today.checkInSubmitted}</p>
          ) : (
            <>
              <p className="text-sm text-ink-soft">{t.clientApp.today.checkInNotSubmitted}</p>
              <Link
                href="/check-in"
                className="mt-3 inline-block rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg hover:opacity-90"
              >
                {t.clientApp.today.checkInCta}
              </Link>
            </>
          )}
          {checkIn.last?.coach_feedback ? (
            <div className="mt-4 rounded-lg bg-accent-soft p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-accent-ink">
                {t.clientApp.today.fromYourCoach}
              </p>
              <p className="mt-1 text-sm leading-snug text-ink-soft">{checkIn.last.coach_feedback}</p>
            </div>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
