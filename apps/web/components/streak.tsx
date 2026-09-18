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
import { NavIcon } from "./client-nav";
import { Card } from "./ui";
import { VisibilityPicker } from "./social";

const FLAME = "M12 22c4 0 7-3 7-7 0-3-2-5-3-7-1 2-2 3-3 3 0-3-1-6-4-8 0 4-4 6-4 12 0 4 3 7 7 7z";
const TROPHY = "M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4";
const CHECK = "m5 12 5 5 9-10";
const CHEVRON = "m9 6 6 6-6 6";

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
 * A flame, 12 day streak, 12 consecutive workout days, Best: 31 days — or the
 * nudge to start one. `compact` is the Today variant: one row, link to the
 * streak page; the full card also carries the calendar.
 */
export function StreakCard({ view, compact = false }: { view: StreakView; compact?: boolean }) {
  const x = useStreakText();
  const { current, longest, activeToday, activeYesterday } = view.summary;
  const none = current === 0;

  return (
    <Card plain>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{x.s.title}</p>
          <p className="mt-1.5 flex items-center gap-2.5 font-display text-xl font-extrabold leading-tight">
            <NavIcon d={FLAME} className="h-[22px] w-[22px] text-accent" />
            {none ? x.s.startTitle : x.dayStreak(current)}
          </p>
          <p className="mt-0.5 text-[13px] text-ink-soft">
            {none ? x.s.startBody : activeToday ? x.consecutive(current) : activeYesterday ? x.s.keepGoing : x.consecutive(current)}
          </p>
        </div>
        {longest > 0 ? (
          <div className="shrink-0 text-right">
            <p className="text-[11px] text-ink-faint">{x.s.longestStreak}</p>
            <p className="text-[13.5px] font-semibold tabular-nums">{longest} {longest === 1 ? x.s.day : x.s.days}</p>
          </div>
        ) : null}
      </div>
      {!none && view.next_milestone !== null && view.next_milestone > current ? (
        <p className="mt-2 text-[12.5px] text-ink-faint">{fill(x.s.nextMilestone, { count: view.next_milestone - current, milestone: view.next_milestone })}</p>
      ) : null}
      {compact ? (
        <Link href="/streak" className="mt-3 inline-block text-[12.5px] font-semibold text-accent-ink hover:underline">
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

/**
 * The streak as one row of the Today training card: flame, "12 day streak",
 * the best on the right, tap for the calendar. Same words as the card,
 * without a card of its own.
 */
export function StreakRow({ view }: { view: StreakView }) {
  const x = useStreakText();
  const { current, longest, activeToday, activeYesterday } = view.summary;
  const none = current === 0;
  return (
    <li>
      <Link href="/streak" className="flex items-center gap-3.5 px-5 py-3.5 hover:bg-bg/60">
        <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full bg-accent-soft text-accent" aria-hidden>
          <NavIcon d={FLAME} className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14.5px] font-semibold">{none ? x.s.startTitle : x.dayStreak(current)}</span>
          <span className="mt-0.5 block text-[12.5px] leading-snug text-ink-faint">
            {none ? x.s.startBody : activeToday ? x.consecutive(current) : activeYesterday ? x.s.keepGoing : x.consecutive(current)}
          </span>
        </span>
        {!none && longest > 0 ? (
          <span className="shrink-0 text-[12.5px] tabular-nums text-ink-faint">{x.best(longest)}</span>
        ) : null}
        <NavIcon d={CHEVRON} className="h-4 w-4 shrink-0 text-ink-faint [stroke-width:2.2]" />
      </Link>
    </li>
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
    // Capped so the squares stay squares on a desktop card; below that the
    // twelve columns stretch to fill, which is what keeps a 375px phone from
    // scrolling sideways.
    <div className="max-w-[380px]">
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
              className={`h-4 min-w-3 rounded-[4px] ${
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
      <p className="mt-2.5 min-h-4 text-[12.5px] text-ink-soft" aria-live="polite">
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
    <Card plain className="bg-accent-soft">
      <p className="flex items-center gap-2.5 font-display text-lg font-bold tracking-tight">
        <NavIcon d={FLAME} className="h-[21px] w-[21px] text-accent-ink" />
        {headline}
      </p>
      {status.event === "record" ? (
        <p className="mt-1 flex items-center gap-1.5 text-[13px] font-semibold text-accent-ink">
          <NavIcon d={TROPHY} className="h-4 w-4" />
          {x.s.newLongest}
        </p>
      ) : null}
      {milestone ? (
        <div className="mt-3.5 border-t border-line/60 pt-3.5">
          <p className="flex items-center gap-2 text-sm font-bold">
            <NavIcon d={TROPHY} className="h-[17px] w-[17px] text-accent-ink" />
            {x.milestone(milestone.milestone)}
          </p>
          <p className="mt-0.5 text-[13px] text-ink-soft">{x.consecutive(milestone.milestone)}</p>
          {milestone.milestone >= STREAK_SHARE_MIN ? <ShareMilestone milestone={milestone.milestone} streakStart={milestone.streak_start} shared={milestone.shared} /> : null}
        </div>
      ) : null}
      <Link
        href="/streak"
        className="mt-3.5 inline-flex h-9 items-center gap-1.5 rounded-full bg-bg px-4 text-[12.5px] font-semibold text-ink-soft hover:text-ink"
      >
        {x.s.viewStreak}
        <NavIcon d={CHEVRON} className="h-3.5 w-3.5 [stroke-width:2.4]" />
      </Link>
    </Card>
  );
}

// ---------- milestones ----------

export function MilestoneList({ view }: { view: StreakView }) {
  const x = useStreakText();
  return (
    <Card plain>
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
        <NavIcon d={TROPHY} className="h-[15px] w-[15px]" />
        {x.s.milestones}
      </p>
      {view.milestones.length === 0 ? (
        <p className="mt-2 text-[13px] text-ink-faint">{x.s.noMilestones}</p>
      ) : (
        <ul className="mt-2 divide-y divide-line/60">
          {view.milestones.map((m) => (
            <li key={`${m.milestone}-${m.streak_start}`} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-3">
              <div className="min-w-0">
                <p className="text-[14px] font-semibold">{x.milestone(m.milestone)}</p>
                <p className="mt-0.5 text-[12.5px] tabular-nums text-ink-faint">{fill(x.s.reachedOn, { date: x.date(m.reached_on) })}</p>
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

  if (done) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-accent-ink">
        <NavIcon d={CHECK} className="h-4 w-4 [stroke-width:2.4]" />
        {s.shared}
      </span>
    );
  }
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex items-center justify-center rounded-full bg-bg font-semibold text-ink-soft hover:text-ink ${
          inline ? "h-9 px-4 text-[12.5px]" : "mt-3 h-11 px-5 text-sm"
        }`}
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
        className="flex h-11 items-center justify-center rounded-2xl bg-accent px-5 font-display text-sm font-bold text-accent-fg hover:opacity-90 disabled:opacity-50"
      >
        {s.shareToFeed}
      </button>
      {error ? <p className="text-xs text-risk">{error}</p> : null}
    </div>
  );
}
