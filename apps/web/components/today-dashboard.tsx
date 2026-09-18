"use client";
import Link from "next/link";
import { useState } from "react";
import type { AdherenceResult } from "@healthapp/shared";
import type {
  ClientCheckInState,
  ClientDayNutrition,
  ClientHabitRow,
  ClientWorkoutDay,
  SessionSummaryRow,
  Signal,
  TrainingLoadSummary,
} from "@/lib/types";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { parseDay, weekDaysOf } from "@/lib/week";
import { HabitTicks } from "./habit-ticks";
import { NavIcon } from "./client-nav";
import { ShareWorkoutButton } from "./share-workout";
import { TrainingLoadBadge } from "./training-load";
import { Card } from "./ui";

// The Today dashboard: the week card (score ring with its four parts, the
// Mon–Sun strip, three stats), then one card per context — training,
// nutrition, habits, coach — each holding everything of its kind, and quiet
// link rows to the rest. The page lays them out in columns.

const CHECK = "m5 12 5 5 9-10";
const CHEVRON = "m9 6 6 6-6 6";

/** Mon–Sun of the current week; workout days carry a gold bar, today is filled. */
export function TodayWeekStrip({ today, workoutDays }: { today: string; workoutDays: string[] }) {
  const { locale } = useI18n();
  const days = weekDaysOf(today);
  const done = new Set(workoutDays);
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "narrow" });
  return (
    <ol className="grid grid-cols-7 gap-1.5">
      {days.map((day) => {
        const isToday = day === today;
        const trained = done.has(day);
        const past = day < today;
        return (
          <li key={day}>
            <div
              className={`flex flex-col items-center gap-0.5 rounded-xl py-1.5 ${
                isToday ? "bg-accent text-accent-fg" : trained ? "bg-accent-soft text-accent-ink" : "bg-bg text-ink-faint"
              } ${past && !trained && !isToday ? "opacity-70" : ""}`}
            >
              <span className="text-[10px] font-semibold uppercase">{weekday.format(parseDay(day))}</span>
              <span className="text-sm font-bold tabular-nums">{parseDay(day).getDate()}</span>
              <span className={`h-[3px] w-4 rounded-full ${trained ? (isToday ? "bg-accent-fg" : "bg-accent") : "bg-transparent"}`} aria-hidden />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// ---------- today, one card per context ----------

/** A filled gold ✓ once the thing is done, an empty ring until then. */
function Dot({ done }: { done: boolean }) {
  return (
    <span
      aria-hidden
      className={`grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full border-[1.5px] ${
        done ? "border-accent bg-accent text-accent-fg" : "border-line text-transparent"
      }`}
    >
      <NavIcon d={CHECK} className="h-[13px] w-[13px] [stroke-width:2.6]" />
    </span>
  );
}

function Chevron() {
  return <NavIcon d={CHEVRON} className="h-4 w-4 text-ink-faint [stroke-width:2.2]" />;
}

/** The uppercase card label, with an optional count or note on the right. */
function CardLabel({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-5 pt-[18px]">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{children}</p>
      {right ? <p className="min-w-0 truncate text-[12.5px] tabular-nums text-ink-faint">{right}</p> : null}
    </div>
  );
}

function Row({ href, done, title, sub, right, children }: {
  href: string;
  done: boolean;
  title: string;
  sub?: string;
  /** Replaces the chevron — the Start pill, a load badge, a Due chip. */
  right?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <li>
      <Link href={href} className="flex items-center gap-3.5 px-5 py-3.5 hover:bg-bg/60">
        <Dot done={done} />
        <div className="min-w-0 flex-1">
          <p className={`truncate text-[14.5px] font-semibold ${done ? "text-ink-soft" : ""}`}>{title}</p>
          {sub ? <p className="mt-0.5 text-[12.5px] leading-snug text-ink-faint">{sub}</p> : null}
          {children}
        </div>
        {right ?? <Chevron />}
      </Link>
    </li>
  );
}

/** A finished session as one line: sets, volume, PRs — under a date or "Done today". */
function SessionMeta({ session, lead }: { session: SessionSummaryRow; lead: string }) {
  const { t, locale } = useI18n();
  const nf = new Intl.NumberFormat(locale === "ro" ? "ro-RO" : "en-GB");
  return (
    <p className="mt-0.5 text-[12.5px] leading-snug tabular-nums text-ink-faint first-letter:uppercase">
      {lead} · {session.sets} {t.clientApp.workoutDay.sets} · {nf.format(Math.round(session.volume_kg))} kg
      {session.prs > 0 ? <> · <span className="font-semibold text-accent-ink">{session.prs} {t.clientApp.workoutDay.prs}</span></> : null}
    </p>
  );
}

/** View / Share under a finished session. */
function SessionActions({ session }: { session: SessionSummaryRow }) {
  const { t } = useI18n();
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <Link
        href={session.day_id ? `/workout/${session.day_id}` : "/workout"}
        className="glass glass--subtle glass--interactive inline-flex h-[34px] items-center rounded-full px-3.5 text-[12.5px] font-semibold text-ink-soft hover:text-ink"
      >
        {t.common.shareCard.view}
      </Link>
      <ShareWorkoutButton
        sessionId={session.id}
        className="glass glass--accent glass--interactive inline-flex h-[34px] items-center rounded-full px-3.5 text-[12.5px] font-semibold text-accent-fg disabled:opacity-50"
      />
    </div>
  );
}

/** How many exercises of today's workout are shown before "+N more". */
const EXERCISE_PREVIEW = 4;

/**
 * Training. Today's workout as its own block — name, program, the first
 * exercises with sets × reps and weight, and the Start (or Continue, once
 * sets are logged) button; done today, the session's numbers with View /
 * Share instead. Under it the last few finished sessions, then the streak.
 * The week's counts and load are not repeated here: the week card has them.
 */
export function TrainingCard({ doneToday, recent, next, coached, streak }: {
  doneToday: SessionSummaryRow | null;
  /** Newest-completed first; today's session, if any, is left out below. */
  recent: SessionSummaryRow[];
  next: ClientWorkoutDay | null;
  /** False for someone training on their own — a solo client, or a coach. */
  coached: boolean;
  /** The streak row (`StreakRow`), rendered by the page from its own read. */
  streak?: React.ReactNode;
}) {
  const { t, locale } = useI18n();
  const d = t.clientApp.today;
  const w = t.clientApp.workout;
  const df = new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short" });
  const previous = recent.filter((s) => s.id !== doneToday?.id);

  const totalSets = next ? next.exercises.reduce((sum, e) => sum + e.sets, 0) : 0;
  const inProgress = next !== null && !next.completed && next.logged.length > 0;
  const programNote = next ? (next.is_own ? w.byYou : w.byCoach) : null;

  return (
    <Card plain className="overflow-hidden p-0">
      <CardLabel right={next ? <span className="truncate">{next.program_name} · {programNote}</span> : undefined}>
        {t.common.nav.training}
      </CardLabel>

      {/* ---- today's workout ---- */}
      <div className="px-5 pb-[18px] pt-3">
        {doneToday ? (
          <>
            <div className="flex items-center justify-between gap-3">
              <p className="flex min-w-0 items-center gap-2 font-display text-[19px] font-extrabold leading-tight tracking-tight">
                <Dot done />
                <span className="truncate">{doneToday.day_name}</span>
              </p>
              <TrainingLoadBadge load={doneToday.load} showLabel={false} />
            </div>
            <SessionMeta
              session={doneToday}
              lead={doneToday.load.duration_min !== null ? `${d.doneToday} · ${doneToday.load.duration_min} min` : d.doneToday}
            />
            <SessionActions session={doneToday} />
          </>
        ) : next ? (
          <>
            <p className="font-display text-[19px] font-extrabold leading-tight tracking-tight">{next.day_name}</p>
            <p className="mt-0.5 text-[12.5px] text-ink-faint">
              {inProgress
                ? fill(d.setsLogged, { done: next.logged.length, total: totalSets })
                : `${d.nextUp} · ${fill(w.exercisesCount, { count: next.exercises.length })}`}
            </p>

            <ul className="mt-3 space-y-1.5">
              {next.exercises.slice(0, EXERCISE_PREVIEW).map((e) => (
                <li key={e.id} className="grid grid-cols-[1fr_auto_auto] items-baseline gap-x-3 text-[13px]">
                  <span className="truncate font-medium">{e.exercise}</span>
                  <span className="tabular-nums text-ink-soft">{e.sets} × {e.reps}</span>
                  <span className="min-w-[3.5rem] text-right tabular-nums text-ink-faint">{e.weight || "—"}</span>
                </li>
              ))}
              {next.exercises.length > EXERCISE_PREVIEW ? (
                <li className="text-[12.5px] text-ink-faint">{fill(w.moreExercises, { count: next.exercises.length - EXERCISE_PREVIEW })}</li>
              ) : null}
            </ul>

            <Link
              href={`/workout/${next.day_id}/log`}
              className="glass glass--accent glass--interactive mt-4 flex h-11 items-center justify-center gap-1.5 rounded-2xl text-[14px] font-bold text-accent-fg"
            >
              {inProgress ? t.clientApp.workoutDay.continueWorkout : t.clientApp.workoutDay.start}
              <NavIcon d={CHEVRON} className="h-3.5 w-3.5 [stroke-width:2.6]" />
            </Link>
          </>
        ) : (
          <Link href={coached ? "/workout" : "/workout/build"} className="flex items-center gap-3.5">
            <Dot done={false} />
            <span className="min-w-0 flex-1 text-[12.5px] leading-snug text-ink-faint">{coached ? d.noProgram : d.noProgramSolo}</span>
            <Chevron />
          </Link>
        )}
      </div>

      {/* ---- recent sessions ---- */}
      {previous.length > 0 ? (
        <div className="border-t border-line/60 px-5 pb-4 pt-3.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">{d.recent}</p>
          <ul className="mt-1.5 space-y-2.5">
            {previous.map((session) => (
              <li key={session.id}>
                <Link href={session.day_id ? `/workout/${session.day_id}` : "/workout"} className="block hover:opacity-80">
                  <div className="flex items-center justify-between gap-3">
                    <p className="min-w-0 truncate text-[13.5px] font-semibold">{session.day_name}</p>
                    <TrainingLoadBadge load={session.load} showLabel={false} />
                  </div>
                  <SessionMeta session={session} lead={df.format(new Date(session.at))} />
                </Link>
              </li>
            ))}
          </ul>
          {!doneToday ? <SessionActions session={previous[0]} /> : null}
        </div>
      ) : null}

      {streak ? <ul className="border-t border-line/60">{streak}</ul> : null}
    </Card>
  );
}

/** One macro against its target as a label, numbers and a thin bar. */
function MacroBar({ label, value, target, unit }: { label: string; value: number; target: number; unit: string }) {
  const { locale } = useI18n();
  const nf = new Intl.NumberFormat(locale === "ro" ? "ro-RO" : "en-GB");
  const ratio = target > 0 ? Math.min(1, value / target) : 0;
  const over = target > 0 && value > target * 1.05;
  return (
    <div className="grid grid-cols-[1fr_auto] gap-x-3 text-[12.5px]">
      <span className="truncate text-ink-soft">{label}</span>
      <span className="font-semibold tabular-nums">
        {nf.format(Math.round(value))} / {nf.format(Math.round(target))} {unit}
      </span>
      <div className="col-span-2 mt-0.5 h-1 overflow-hidden rounded-full bg-bg">
        <div className={`h-full rounded-full ${over ? "bg-warn" : "bg-accent"}`} style={{ width: `${ratio * 100}%` }} />
      </div>
    </div>
  );
}

const MEAL_SLOTS = ["breakfast", "lunch", "dinner", "snack"] as const;

/**
 * Nutrition. The day's calories against the target with what is left (or
 * over), the three macros as bars, then a row per meal — what was logged and
 * its calories, or "nothing yet" — and the way to log more.
 */
export function NutritionCard({ nutrition }: { nutrition: ClientDayNutrition }) {
  const { t, locale } = useI18n();
  const d = t.clientApp.today;
  const nf = new Intl.NumberFormat(locale === "ro" ? "ro-RO" : "en-GB");
  const n = (v: number) => nf.format(Math.round(v));

  const kcalTarget = nutrition.target.kcal;
  const kcal = nutrition.totals.kcal;
  const hasTarget = kcalTarget > 0;
  const ratio = hasTarget ? Math.min(1, kcal / kcalTarget) : 0;
  const over = hasTarget && kcal > kcalTarget * 1.05;
  const diff = Math.abs(kcalTarget - kcal);
  const planNote = nutrition.plan_owner === "coach" ? t.clientApp.workout.byCoach : nutrition.plan_owner === "self" ? t.clientApp.workout.byYou : null;

  const bySlot = MEAL_SLOTS.map((slot) => {
    const entries = nutrition.entries.filter((e) => e.slot === slot);
    return {
      slot,
      names: entries.map((e) => e.food_name).join(", "),
      kcal: entries.reduce((sum, e) => sum + e.macros.kcal, 0),
    };
  });

  return (
    <Card plain className="overflow-hidden p-0">
      <CardLabel right={planNote ? <span className="truncate">{nutrition.plan_name ? `${nutrition.plan_name} · ` : ""}{planNote}</span> : undefined}>
        {t.common.nav.nutrition}
      </CardLabel>

      {/* ---- calories and macros ---- */}
      <div className="px-5 pb-[18px] pt-3">
        <div className="flex items-baseline justify-between gap-3">
          <p className="font-display text-[19px] font-extrabold leading-tight tracking-tight tabular-nums">
            {n(kcal)}
            {hasTarget ? <span className="text-ink-faint"> / {n(kcalTarget)}</span> : null}
            <span className="ml-1 font-sans text-[12.5px] font-medium text-ink-faint">kcal</span>
          </p>
          {hasTarget ? (
            <p className={`shrink-0 text-[12.5px] font-semibold tabular-nums ${over ? "text-warn" : "text-ink-faint"}`}>
              {n(diff)} {over ? d.over : d.left}
            </p>
          ) : (
            <p className="shrink-0 text-[12.5px] text-ink-faint">{d.noTargetYet}</p>
          )}
        </div>
        {hasTarget ? (
          <>
            <div className="mt-2 h-[5px] overflow-hidden rounded-full bg-bg">
              <div className={`h-full rounded-full ${over ? "bg-warn" : "bg-accent"}`} style={{ width: `${ratio * 100}%` }} />
            </div>
            <div className="mt-3.5 space-y-[7px]">
              <MacroBar label={t.common.macros.protein} value={nutrition.totals.protein} target={nutrition.target.protein} unit="g" />
              <MacroBar label={t.common.macros.carbs} value={nutrition.totals.carbs} target={nutrition.target.carbs} unit="g" />
              <MacroBar label={t.common.macros.fat} value={nutrition.totals.fat} target={nutrition.target.fat} unit="g" />
            </div>
          </>
        ) : null}
      </div>

      {/* ---- meals ---- */}
      <div className="border-t border-line/60 px-5 pb-4 pt-3.5">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">{d.meals}</p>
        <ul className="mt-1.5 space-y-2">
          {bySlot.map((m) => (
            <li key={m.slot}>
              <Link href="/food" className="grid grid-cols-[5.5rem_1fr_auto] items-baseline gap-x-3 text-[13px] hover:opacity-80">
                <span className="truncate font-medium">{t.clientApp.food[m.slot]}</span>
                <span className={`truncate ${m.names ? "text-ink-soft" : "text-ink-faint"}`}>{m.names || d.nothingYet}</span>
                <span className="tabular-nums text-ink-faint">{m.names ? `${n(m.kcal)} kcal` : "—"}</span>
              </Link>
            </li>
          ))}
        </ul>
        <Link
          href="/food"
          className="glass glass--subtle glass--interactive mt-3.5 flex h-10 items-center justify-center gap-1.5 rounded-2xl text-[13px] font-semibold text-ink-soft hover:text-ink"
        >
          <NavIcon d="M12 5v14M5 12h14" className="h-3.5 w-3.5 [stroke-width:2.4]" />
          {d.logFood}
        </Link>
      </div>
    </Card>
  );
}

/** Habits: the day's ticks, grouped by category, with the done count up top. */
export function HabitsCard({ habits }: { habits: ClientHabitRow[] }) {
  const { t } = useI18n();
  const d = t.clientApp.today;
  const habitsDone = habits.filter((h) => h.done_today).length;

  return (
    <Card plain className="overflow-hidden p-0">
      <CardLabel right={habits.length > 0 ? `${habitsDone}/${habits.length}` : undefined}>
        <Link href="/habits" className="hover:text-ink">{t.common.nav.habits}</Link>
      </CardLabel>
      <div className="px-4 pb-3.5 pt-2.5">
        {habits.length > 0 ? (
          <HabitTicks habits={habits} />
        ) : (
          <Link href="/habits" className="flex items-center gap-3.5 px-1.5 py-1.5">
            <Dot done={false} />
            <span className="min-w-0 flex-1 text-[12.5px] text-ink-faint">{d.noHabitsYet}</span>
            <Chevron />
          </Link>
        )}
      </div>
    </Card>
  );
}

/**
 * Coach: the weekly check-in, the last word from the coach, and any messages
 * not yet opened. For someone training solo the card is just the check-in.
 */
export function CoachCard({ checkIn, coached, unread }: {
  checkIn: ClientCheckInState;
  coached: boolean;
  unread: number;
}) {
  const { t } = useI18n();
  const d = t.clientApp.today;

  return (
    <Card plain className="overflow-hidden p-0">
      <CardLabel>{coached ? t.common.nav.coach : t.common.nav.checkIn}</CardLabel>
      <ul className="mt-2 divide-y divide-line/60">
        <Row
          href="/check-in"
          done={checkIn.submitted}
          title={d.weeklyCheckIn}
          sub={checkIn.submitted ? d.checkInSubmitted : d.checkInNotSubmitted}
          right={checkIn.submitted ? undefined : <span className="shrink-0 rounded-full bg-warn-soft px-2.5 py-0.5 text-[11px] font-bold text-warn">{d.due}</span>}
        />

        {checkIn.last?.coach_feedback ? (
          <li className="px-5 py-3.5">
            <div className="rounded-2xl bg-accent-soft px-4 py-3.5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-accent-ink">{d.fromYourCoach}</p>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-soft">{checkIn.last.coach_feedback}</p>
            </div>
          </li>
        ) : null}

        {/* Messages the coach sent and this client has not opened. */}
        {unread > 0 ? (
          <li>
            <Link href="/coach" className="flex items-center gap-3.5 px-5 py-3.5 hover:bg-bg/60">
              <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full bg-accent font-display text-[11px] font-bold tabular-nums text-accent-fg">
                {unread > 9 ? "9+" : unread}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14.5px] font-semibold">
                  {unread === 1 ? d.unreadMessageOne : fill(d.unreadMessages, { count: unread })}
                </span>
                <span className="mt-0.5 block text-[12.5px] text-ink-faint">{d.openConversation}</span>
              </span>
              <Chevron />
            </Link>
          </li>
        ) : null}
      </ul>
    </Card>
  );
}

// ---------- this week ----------

const TONE: Record<Signal, { text: string; stroke: string }> = {
  on_track: { text: "text-accent-ink", stroke: "var(--color-accent)" },
  needs_attention: { text: "text-warn", stroke: "var(--color-warn)" },
  at_risk: { text: "text-risk", stroke: "var(--color-risk)" },
};

function Stat({ href, label, value, unit, unitTone = "text-ink-faint" }: {
  href: string;
  label: string;
  value: string;
  unit?: string;
  unitTone?: string;
}) {
  return (
    <Link href={href} className="min-w-0 px-1.5 text-center hover:opacity-80">
      <p className="truncate text-[10px] font-semibold uppercase tracking-wider text-ink-faint">{label}</p>
      <p className="mt-0.5 font-display text-xl font-bold tabular-nums leading-tight">
        {value}
        {unit ? <span className={`ml-1 font-sans text-[11.5px] font-medium ${unitTone}`}>{unit}</span> : null}
      </p>
    </Link>
  );
}

/**
 * The week in one card: the score as a ring with its signal, the four parts
 * that make it as label–value rows (so 32% is never a mystery), the Mon–Sun
 * strip, and three stats. `nudge` is the at-risk copy the page already localised.
 */
export function WeekCard({ adherence, today, workoutDays, done, planned, streak, nudge, load }: {
  adherence: AdherenceResult;
  today: string;
  workoutDays: string[];
  done: number;
  planned: number;
  streak: number;
  nudge: string | null;
  load: TrainingLoadSummary;
}) {
  const { t, locale } = useI18n();
  const d = t.clientApp.today;
  const [open, setOpen] = useState(false);
  const tone = TONE[adherence.signal];
  const pct = Math.round(adherence.overall * 100);
  const days = weekDaysOf(today);
  const df = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" });
  const range = `${df.format(parseDay(days[0]))} – ${df.format(parseDay(days[6]))}`;
  const pc = (v: number) => `${Math.round(v * 100)}%`;
  const parts = [
    { label: d.scoreParts.workouts, value: adherence.workout, text: `${done} / ${planned || 3}` },
    { label: d.scoreParts.nutrition, value: adherence.nutrition, text: pc(adherence.nutrition) },
    { label: d.scoreParts.habits, value: adherence.habits, text: pc(adherence.habits) },
    { label: d.scoreParts.checkIn, value: adherence.checkin ? 1 : 0, text: adherence.checkin ? "100%" : "—" },
  ];
  const r = 39;
  const c = 2 * Math.PI * r;
  const delta = load.trend.delta_pct;
  const deltaText = delta === null ? undefined : `${delta > 0 ? "+" : ""}${delta.toLocaleString(locale, { maximumFractionDigits: 0 })}%`;
  const deltaTone = load.trend.direction === "increased" ? "text-accent-ink" : load.trend.direction === "decreased" ? "text-warn" : "text-ink-faint";

  return (
    <Card plain>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{d.weeklyScore}</p>
        <p className="text-xs text-ink-faint">{range}</p>
      </div>

      <div className="mt-3.5 flex items-center gap-[18px]">
        <div className="relative h-24 w-24 shrink-0">
          <svg viewBox="0 0 96 96" className="h-24 w-24 -rotate-90" aria-hidden>
            <circle cx="48" cy="48" r={r} fill="none" stroke="var(--color-bg)" strokeWidth="9" />
            {pct > 0 ? (
              <circle
                cx="48" cy="48" r={r} fill="none"
                stroke={tone.stroke} strokeWidth="9" strokeLinecap="round"
                strokeDasharray={`${c * Math.min(1, adherence.overall)} ${c}`}
              />
            ) : null}
          </svg>
          <span className="absolute inset-0 flex items-center justify-center font-display text-[22px] font-extrabold tabular-nums">{pct}%</span>
        </div>
        <div className="min-w-0 flex-1 space-y-[7px]">
          <p className={`flex items-center gap-2 text-base font-bold leading-tight ${tone.text}`}>
            {t.common.signal[adherence.signal]}
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-label={d.statusInfo}
              className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-full border border-line text-[10px] font-semibold text-ink-faint hover:text-ink"
            >
              i
            </button>
          </p>
          {open ? <p className="text-xs leading-snug text-ink-faint">{d.statusInfo}</p> : null}
          {parts.map((p) => (
            <div key={p.label} className="grid grid-cols-[1fr_auto] gap-x-3 text-[12.5px]">
              <span className="truncate text-ink-soft">{p.label}</span>
              <span className="font-semibold tabular-nums">{p.text}</span>
              <div className="col-span-2 mt-0.5 h-1 overflow-hidden rounded-full bg-bg">
                <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round(p.value * 100)}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {nudge ? <p className="mt-3 rounded-[14px] bg-risk-soft px-3 py-2.5 text-[12.5px] leading-snug text-risk">{nudge}</p> : null}

      <div className="mt-4">
        <TodayWeekStrip today={today} workoutDays={workoutDays} />
      </div>

      <div className="mt-4 grid grid-cols-3 divide-x divide-line/60 border-t border-line/60 pt-3.5">
        <Stat href="/workout" label={d.workouts} value={String(done)} unit={`/ ${planned || 3}`} />
        <Stat href="/progress" label={d.streak} value={String(streak)} unit={streak === 1 ? d.day : d.days} />
        <Stat href="/today?week=current#weekly-report" label={t.common.trainingLoad.short} value={String(load.this_week)} unit={deltaText} unitTone={deltaTone} />
      </div>
    </Card>
  );
}

// ---------- everything else ----------

/** A quiet one-line link row for a `divide-y` list: icon (a 24-box stroke path), label, optional meta, chevron. */
export function LinkRow({ href, icon, label, meta }: { href: string; icon: string; label: string; meta?: string }) {
  return (
    <li>
      <Link href={href} className="flex items-center gap-3.5 px-5 py-3.5 hover:bg-bg/60">
        <span className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[11px] bg-accent-soft text-accent-ink" aria-hidden>
          <NavIcon d={icon} className="h-[17px] w-[17px]" />
        </span>
        <span className="min-w-0 flex-1 truncate text-[14.5px] font-semibold">{label}</span>
        {meta ? <span className="shrink-0 text-[12.5px] tabular-nums text-ink-faint">{meta}</span> : null}
        <Chevron />
      </Link>
    </li>
  );
}
