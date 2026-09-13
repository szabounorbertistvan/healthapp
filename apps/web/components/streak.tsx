"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { STREAK_SHARE_MIN, type CalendarDay, type PostVisibility } from "@healthapp/shared";
import { shareStreak } from "@/app/social-actions";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { parseDay } from "@/lib/week";
import type { StreakView } from "@/lib/streak-data";
import { Card } from "./ui";
import { VisibilityPicker } from "./social";

function useStreakText() {
  const { t, locale } = useI18n();
  const s = t.common.streaks;
  const df = new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", { day: "numeric", month: "short" });
  return {
    s,
    date: (day: string) => df.format(parseDay(day)),
    dayStreak: (n: number) => (n === 1 ? s.dayStreakOne : fill(s.dayStreak, { count: n })),
    consecutive: (n: number) => (n === 1 ? s.consecutiveDaysOne : fill(s.consecutiveDays, { count: n })),
    best: (n: number) => (n === 1 ? s.bestOne : fill(s.best, { count: n })),
    milestone: (n: number) => fill(s.milestoneTitle, { count: n }),
  };
}

// ---------- the card ----------

/**
 * 🔥 12 day streak / 12 consecutive workout days / Best: 31 days — or the
 * nudge to start one. `compact` is the Today variant: one row, link to the
 * streak page; the full card also carries the calendar.
 */
export function StreakCard({ view, compact = false }: { view: StreakView; compact?: boolean }) {
  const x = useStreakText();
  const { current, longest, activeToday, activeYesterday } = view.summary;
  const none = current === 0;

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{x.s.title}</p>
          <p className="mt-1 text-lg font-bold leading-tight">🔥 {none ? x.s.startTitle : x.dayStreak(current)}</p>
          <p className="mt-0.5 text-sm text-ink-soft">
            {none ? x.s.startBody : activeToday ? x.consecutive(current) : activeYesterday ? x.s.keepGoing : x.consecutive(current)}
          </p>
        </div>
        {longest > 0 ? (
          <div className="shrink-0 text-right">
            <p className="text-[11px] text-ink-faint">🏆 {x.s.longestStreak}</p>
            <p className="text-sm font-semibold tabular-nums">{longest} {longest === 1 ? x.s.day : x.s.days}</p>
          </div>
        ) : null}
      </div>
      {!none && view.next_milestone !== null && view.next_milestone > current ? (
        <p className="mt-2 text-xs text-ink-faint">{fill(x.s.nextMilestone, { count: view.next_milestone - current, milestone: view.next_milestone })}</p>
      ) : null}
      {compact ? (
        <Link href="/streak" className="mt-3 inline-block text-xs font-semibold text-accent-ink hover:underline">
          {x.s.viewStreak} →
        </Link>
      ) : (
        <div className="mt-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{x.s.calendarTitle}</p>
          <StreakCalendar calendar={view.calendar} />
        </div>
      )}
    </Card>
  );
}

// ---------- calendar ----------

/**
 * Twelve weeks as columns, weekdays as rows; a square per day, filled when
 * a workout was completed. Tap or hover a day for "Sep 13 — Workout". Sized
 * so 12 columns fit a 375px screen without scrolling sideways.
 */
export function StreakCalendar({ calendar }: { calendar: CalendarDay[][] }) {
  const x = useStreakText();
  const { locale } = useI18n();
  const [picked, setPicked] = useState<CalendarDay | null>(null);
  // Monday → Sunday, narrow, in the viewer's language (the first week of the grid is a full one).
  const narrow = new Intl.DateTimeFormat(locale, { weekday: "narrow" });
  const weekdays = (calendar[0] ?? []).map((d) => narrow.format(parseDay(d.day)));
  const label = (d: CalendarDay) =>
    `${x.date(d.day)} — ${d.workouts === 0 ? x.s.restDay : d.workouts === 1 ? x.s.workout : fill(x.s.workouts, { count: d.workouts })}`;

  return (
    <div>
      <div className="flex gap-1">
        <div className="grid shrink-0 grid-rows-7 gap-1 pr-1 text-[9px] leading-none text-ink-faint">
          {weekdays.map((w, i) => (
            <span key={i} className="flex h-4 items-center">{i % 2 === 0 ? w : ""}</span>
          ))}
        </div>
        <div className="grid flex-1 grid-flow-col grid-rows-7 gap-1" role="grid" aria-label={x.s.calendarTitle}>
          {calendar.flat().map((d) => (
            <button
              key={d.day}
              type="button"
              role="gridcell"
              disabled={d.future}
              title={d.future ? undefined : label(d)}
              aria-label={d.future ? undefined : label(d)}
              aria-pressed={picked?.day === d.day}
              onClick={() => setPicked(d)}
              onMouseEnter={() => setPicked(d)}
              className={`h-4 min-w-3 rounded-[3px] ${
                d.future
                  ? "bg-transparent"
                  : d.workouts > 0
                    ? "bg-accent"
                    : "bg-line/60"
              } ${picked?.day === d.day ? "ring-2 ring-accent-ink ring-offset-1 ring-offset-surface" : ""}`}
            />
          ))}
        </div>
      </div>
      <p className="mt-2 min-h-4 text-xs text-ink-soft" aria-live="polite">
        {picked && !picked.future ? label(picked) : " "}
      </p>
    </div>
  );
}

// ---------- after a workout ----------

/**
 * What finishing today's workout did to the streak — started, extended, a
 * record, a milestone — and the choice to share a milestone worth sharing.
 * The status is derived from the day, so a reload says the same thing and
 * never announces the same milestone twice.
 */
export function StreakAfterWorkout({ view }: { view: StreakView }) {
  const x = useStreakText();
  const { status, summary } = view;
  if (status.event === "none") return null;
  const headline =
    status.event === "started" ? x.s.streakStarted : fill(x.s.streakExtended, { count: summary.current });
  const milestone = status.milestone !== null ? view.milestones.find((m) => m.milestone === status.milestone && m.current) ?? null : null;
  return (
    <Card className="bg-accent-soft">
      <p className="text-lg font-bold">🔥 {headline}</p>
      {status.event === "record" ? <p className="mt-0.5 text-sm font-semibold text-accent-ink">🏆 {x.s.newLongest}</p> : null}
      {milestone ? (
        <div className="mt-3 border-t border-line/60 pt-3">
          <p className="font-bold">🏆 {x.milestone(milestone.milestone)}</p>
          <p className="text-sm text-ink-soft">{x.consecutive(milestone.milestone)}</p>
          {milestone.milestone >= STREAK_SHARE_MIN ? <ShareMilestone milestone={milestone.milestone} streakStart={milestone.streak_start} shared={milestone.shared} /> : null}
        </div>
      ) : null}
      <Link href="/streak" className="mt-3 inline-block text-xs font-semibold text-accent-ink hover:underline">
        {x.s.viewStreak} →
      </Link>
    </Card>
  );
}

// ---------- milestones ----------

export function MilestoneList({ view }: { view: StreakView }) {
  const x = useStreakText();
  return (
    <Card>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">🏆 {x.s.milestones}</p>
      {view.milestones.length === 0 ? (
        <p className="mt-2 text-sm text-ink-soft">{x.s.noMilestones}</p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {view.milestones.map((m) => (
            <li key={`${m.milestone}-${m.streak_start}`} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2.5">
              <div className="min-w-0">
                <p className="font-semibold">{x.milestone(m.milestone)}</p>
                <p className="text-xs text-ink-faint">{fill(x.s.reachedOn, { date: x.date(m.reached_on) })}</p>
              </div>
              {m.milestone >= STREAK_SHARE_MIN ? <ShareMilestone milestone={m.milestone} streakStart={m.streak_start} shared={m.shared} inline /> : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Share to Feed for one milestone — once; the server dedupes on (milestone, streak_start). */
function ShareMilestone({ milestone, streakStart, shared, inline = false }: { milestone: number; streakStart: string; shared: boolean; inline?: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [visibility, setVisibility] = useState<PostVisibility>("followers");
  const [done, setDone] = useState(shared);
  const [error, setError] = useState<string | null>(null);
  const s = t.common.social;

  if (done) return <span className="text-xs font-semibold text-accent-ink">✓ {s.shared}</span>;
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`rounded-lg border border-line font-semibold hover:border-accent ${inline ? "min-h-9 px-3 text-xs" : "mt-3 min-h-11 px-4 text-sm"}`}
      >
        {s.shareToFeed}
      </button>
    );
  }
  return (
    <div className={`${inline ? "basis-full" : "mt-3"} space-y-2`}>
      <VisibilityPicker value={visibility} onChange={setVisibility} />
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const r = await shareStreak(milestone, streakStart, visibility);
            if (!r.ok) setError(r.message ?? "Error");
            else setDone(true);
            router.refresh();
          })
        }
        className="min-h-11 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-fg disabled:opacity-50"
      >
        {s.shareToFeed}
      </button>
      {error ? <p className="text-xs text-risk">{error}</p> : null}
    </div>
  );
}
