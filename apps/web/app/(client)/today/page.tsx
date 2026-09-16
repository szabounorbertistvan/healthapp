import Link from "next/link";
import { redirect } from "next/navigation";
import { getMySessions, getToday, isEmptyAccount } from "@/lib/client-data";
import { getMyChallenges } from "@/lib/challenges-data";
import { getMyWeeklySummary, type WeekChoice } from "@/lib/weekly-data";
import { getMyStreak } from "@/lib/streak-data";
import { getLeaderboard } from "@/lib/leaderboard-data";
import { hasChosenSolo } from "@/lib/onboarding";
import { Card, EmptyState } from "@/components/ui";
import { LinkRow, TodayChecklist, WeekCard } from "@/components/today-dashboard";
import { NavIcon } from "@/components/client-nav";
import { TrainingLoadSummaryCard } from "@/components/training-load";
import { StreakCard } from "@/components/streak";
import { LeaderboardSummaryCard } from "@/components/leaderboard";
import { WeeklySummaryCard } from "@/components/weekly-summary";
import { ShareWorkoutButton } from "@/components/share-workout";
import { TrainingLoadBadge } from "@/components/training-load";
import { timeAgo } from "@/lib/format";
import { parseDay } from "@/lib/week";
import { getI18n } from "@/lib/i18n/server";
import { fill } from "@/lib/i18n";
import { isoDay } from "@/lib/dates";

/**
 * Today. Three columns once there is room, one on a phone, in this order: the
 * date, today's checklist (the one card that answers "what do I do now") and a
 * word from the coach; the week's score with its parts and the workout streak;
 * the last workout, the leaderboard, links to the rest, and the weekly report
 * folded away for whoever wants the numbers.
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
  ]);
  reads.catch(() => {});
  if (!(await hasChosenSolo()) && (await isEmptyAccount())) redirect("/welcome");

  const [today, challenges, weekly, recent, streakView, board] = await reads;
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
  // getMySessions is newest-completed first: [0] is the last finished workout.
  const lastWorkout = recent[0] ?? null;
  const lastWorkoutDate = lastWorkout
    ? new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short" }).format(new Date(lastWorkout.at))
    : null;
  const workoutDays = today.training_load.daily.filter((x) => x.load > 0).map((x) => x.day);
  const activeChallenges = challenges.filter((c) => c.joined && c.status === "active").length;
  const nudge = adherence.signal === "at_risk" ? fill(d.atRiskBody, { time: timeAgo(last, locale) }) : null;

  return (
    // Capped at 1600px: a dashboard of cards, three columns wide at most.
    <div className="mx-auto max-w-[1600px]">
      <header>
        <h1 className="font-display text-2xl font-extrabold tracking-tight first-letter:uppercase sm:text-[28px]">{weekday}</h1>
        <p className="mt-1 text-[13px] text-ink-faint first-letter:uppercase">{longDate}</p>
      </header>

      <div className="mt-4 grid items-start gap-4 sm:mt-6 md:grid-cols-2 md:gap-5 xl:grid-cols-3 xl:gap-6">
        {/* ---- what to do today ---- */}
        <div className="space-y-4">
          <TodayChecklist doneToday={doneToday} next={next} nutrition={nutrition} habits={habits} checkIn={checkIn} />

          {checkIn.last?.coach_feedback ? (
            <div className="rounded-3xl bg-accent-soft px-5 py-[18px]">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-accent-ink">{d.fromYourCoach}</p>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-soft">{checkIn.last.coach_feedback}</p>
            </div>
          ) : null}

          {/* Messages the coach sent and this client has not opened. Until now
              unread_from_coach was hardcoded 0 and read by nothing, so a coach
              could write and the client would never learn of it from Today. */}
          {today.unread_from_coach > 0 ? (
            <Link
              href="/coach"
              className="flex items-center justify-between gap-3 rounded-3xl bg-surface px-5 py-[18px] transition hover:bg-accent-soft/40"
            >
              <span className="min-w-0">
                <span className="block text-[13.5px] font-bold">
                  {today.unread_from_coach === 1
                    ? d.unreadMessageOne
                    : fill(d.unreadMessages, { count: today.unread_from_coach })}
                </span>
                <span className="mt-0.5 block text-[12.5px] text-ink-faint">{d.openConversation}</span>
              </span>
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent font-display text-[12px] font-bold tabular-nums text-accent-fg">
                {today.unread_from_coach > 9 ? "9+" : today.unread_from_coach}
              </span>
            </Link>
          ) : null}
        </div>

        {/* ---- the week ---- */}
        <div className="space-y-4">
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
        </div>

        {/* ---- everything else ---- */}
        <div className="space-y-4">
          {lastWorkout ? (
            <Card plain>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{t.common.shareCard.lastWorkout}</p>
                  <p className="mt-1.5 truncate text-[15px] font-semibold">{lastWorkout.day_name}</p>
                  <p className="mt-0.5 text-[12.5px] tabular-nums text-ink-faint first-letter:uppercase">
                    {lastWorkoutDate} · {lastWorkout.sets} {t.clientApp.workoutDay.sets} · {new Intl.NumberFormat(locale).format(lastWorkout.volume_kg)} kg
                    {lastWorkout.prs > 0 ? <> · <span className="font-semibold text-accent-ink">{lastWorkout.prs} {t.clientApp.workoutDay.prs}</span></> : null}
                  </p>
                </div>
                <TrainingLoadBadge load={lastWorkout.load} showLabel={false} />
              </div>
              <div className="mt-3.5 flex flex-wrap gap-2">
                <Link
                  href={lastWorkout.day_id ? `/workout/${lastWorkout.day_id}` : "/workout"}
                  className="inline-flex h-[38px] items-center rounded-full bg-bg px-4 text-[13px] font-semibold text-ink-soft hover:text-ink"
                >
                  {t.common.shareCard.view}
                </Link>
                <ShareWorkoutButton
                  sessionId={lastWorkout.id}
                  className="inline-flex h-[38px] items-center rounded-full bg-accent px-4 text-[13px] font-semibold text-accent-fg hover:opacity-90 disabled:opacity-50"
                />
              </div>
            </Card>
          ) : null}

          <LeaderboardSummaryCard board={board} />

          <Card plain className="overflow-hidden p-0">
            <ul className="divide-y divide-line/60">
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
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-3xl bg-surface px-5 py-3.5 hover:bg-accent-soft/40 [&::-webkit-details-marker]:hidden">
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
