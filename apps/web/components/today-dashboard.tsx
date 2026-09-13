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
import { TrainingLoadBadge } from "./training-load";
import { Card } from "./ui";

// The Today dashboard, phone-first, in three blocks: the checklist of what to
// do today (workout, food, habits, check-in — one row each, tap to go do it),
// the week card (score ring, its four parts, the Mon–Sun strip, three stats),
// and quiet links to everything else. The weekly report folds away below.

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
              className={`flex flex-col items-center gap-0.5 rounded-lg py-1.5 ${
                isToday ? "bg-accent text-accent-fg" : trained ? "bg-accent-soft text-accent-ink" : "bg-bg text-ink-faint"
              } ${past && !trained && !isToday ? "opacity-70" : ""}`}
            >
              <span className="text-[10px] font-semibold uppercase">{weekday.format(parseDay(day))}</span>
              <span className="text-sm font-bold tabular-nums">{parseDay(day).getDate()}</span>
              <span className={`h-1 w-4 rounded-full ${trained ? (isToday ? "bg-accent-fg" : "bg-accent") : "bg-transparent"}`} aria-hidden />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// ---------- today's plan ----------

/** A filled gold ✓ once the thing is done, an empty ring until then. */
function Dot({ done }: { done: boolean }) {
  return (
    <span
      aria-hidden
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-black ${
        done ? "border-accent bg-accent text-accent-fg" : "border-line text-transparent"
      }`}
    >
      ✓
    </span>
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
      <Link href={href} className="flex items-center gap-3 px-4 py-3 hover:bg-bg">
        <Dot done={done} />
        <div className="min-w-0 flex-1">
          <p className={`truncate text-sm font-semibold ${done ? "text-ink-soft" : ""}`}>{title}</p>
          {sub ? <p className="mt-0.5 text-xs leading-snug text-ink-faint">{sub}</p> : null}
          {children}
        </div>
        {right ?? <span className="text-lg text-ink-faint" aria-hidden>›</span>}
      </Link>
    </li>
  );
}

/**
 * Everything the client is meant to do today as one list. The workout row is
 * the primary action (Start pill); food and check-in navigate; habits tick in
 * place, because ticking is the smallest and most repeated action in the app.
 */
export function TodayChecklist({ doneToday, next, nutrition, habits, checkIn }: {
  doneToday: SessionSummaryRow | null;
  next: ClientWorkoutDay | null;
  nutrition: ClientDayNutrition;
  habits: ClientHabitRow[];
  checkIn: ClientCheckInState;
}) {
  const { t, locale } = useI18n();
  const d = t.clientApp.today;
  const nf = new Intl.NumberFormat(locale === "ro" ? "ro-RO" : "en-GB");
  const n = (v: number) => nf.format(Math.round(v));

  const habitsDone = habits.filter((h) => h.done_today).length;
  const allHabits = habits.length > 0 && habitsDone === habits.length;

  const kcalTarget = nutrition.target.kcal;
  const logged = nutrition.entries.length > 0;
  const ratio = kcalTarget > 0 ? Math.min(1, nutrition.totals.kcal / kcalTarget) : 0;
  const over = kcalTarget > 0 && nutrition.totals.kcal > kcalTarget * 1.05;
  const foodSub = logged
    ? kcalTarget > 0
      ? `${n(nutrition.totals.kcal)} / ${n(kcalTarget)} kcal · ${t.common.macros.protein} ${n(nutrition.totals.protein)} / ${n(nutrition.target.protein)} g`
      : `${n(nutrition.totals.kcal)} kcal ${d.logged}`
    : kcalTarget > 0
      ? `${d.nothingLogged} · ${fill(d.kcalTarget, { kcal: n(kcalTarget) })}`
      : d.nothingLogged;

  return (
    <Card className="overflow-hidden p-0">
      <p className="px-4 pt-4 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{d.plan}</p>
      <ul className="mt-2 divide-y divide-line">
        {doneToday ? (
          <Row
            href={doneToday.day_id ? `/workout/${doneToday.day_id}` : "/workout"}
            done
            title={doneToday.day_name}
            sub={[d.doneToday, doneToday.load.duration_min !== null ? `${doneToday.load.duration_min} min` : null, `${n(doneToday.volume_kg)} kg`]
              .filter(Boolean)
              .join(" · ")}
            right={<TrainingLoadBadge load={doneToday.load} showLabel={false} />}
          />
        ) : next ? (
          <Row
            href={`/workout/${next.day_id}/log`}
            done={false}
            title={next.day_name}
            sub={`${d.nextUp} · ${fill(t.clientApp.workout.exercisesCount, { count: next.exercises.length })}`}
            right={<span className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg">{d.start} ›</span>}
          />
        ) : (
          <Row href="/workout" done={false} title={t.common.nav.training} sub={d.noProgram} />
        )}

        <Row href="/food" done={logged} title={t.common.nav.nutrition} sub={foodSub}>
          {kcalTarget > 0 ? (
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-bg">
              <div className={`h-full rounded-full ${over ? "bg-warn" : "bg-accent"}`} style={{ width: `${ratio * 100}%` }} />
            </div>
          ) : null}
        </Row>

        <li className="px-4 py-3">
          <Link href="/habits" className="flex items-center gap-3">
            <Dot done={allHabits} />
            <span className={`min-w-0 flex-1 truncate text-sm font-semibold ${allHabits ? "text-ink-soft" : ""}`}>{t.common.nav.habits}</span>
            {habits.length > 0 ? (
              <span className="shrink-0 text-xs tabular-nums text-ink-faint">{habitsDone}/{habits.length}</span>
            ) : (
              <span className="text-lg text-ink-faint" aria-hidden>›</span>
            )}
          </Link>
          {habits.length > 0 ? (
            <div className="mt-1.5 pl-8">
              <HabitTicks habits={habits} />
            </div>
          ) : (
            <p className="mt-0.5 pl-9 text-xs text-ink-faint">{d.noHabitsYet}</p>
          )}
        </li>

        <Row
          href="/check-in"
          done={checkIn.submitted}
          title={d.weeklyCheckIn}
          sub={checkIn.submitted ? d.checkInSubmitted : d.checkInNotSubmitted}
          right={checkIn.submitted ? undefined : <span className="shrink-0 rounded-md bg-warn-soft px-2 py-0.5 text-xs font-semibold text-warn">{d.due}</span>}
        />
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
    <Link href={href} className="min-w-0 px-2 text-center first:pl-0 last:pr-0 hover:opacity-80">
      <p className="truncate text-[10px] font-semibold uppercase tracking-wider text-ink-faint">{label}</p>
      <p className="mt-0.5 text-lg font-bold tabular-nums leading-tight">
        {value}
        {unit ? <span className={`ml-1 text-xs font-medium ${unitTone}`}>{unit}</span> : null}
      </p>
    </Link>
  );
}

/**
 * The week in one card: the score as a ring with its signal, the four parts
 * that make it (so 32% is never a mystery), the Mon–Sun strip, and three
 * stats. `nudge` is the at-risk copy the page already localised.
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
  const parts = [
    { label: d.scoreParts.workouts, value: adherence.workout },
    { label: d.scoreParts.nutrition, value: adherence.nutrition },
    { label: d.scoreParts.habits, value: adherence.habits },
    { label: d.scoreParts.checkIn, value: adherence.checkin ? 1 : 0 },
  ];
  const r = 26;
  const c = 2 * Math.PI * r;
  const delta = load.trend.delta_pct;
  const deltaText = delta === null ? undefined : `${delta > 0 ? "+" : ""}${delta.toLocaleString(locale, { maximumFractionDigits: 0 })}%`;
  const deltaTone = load.trend.direction === "increased" ? "text-accent-ink" : load.trend.direction === "decreased" ? "text-warn" : "text-ink-faint";

  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{d.weeklyScore}</p>
        <p className="text-xs text-ink-faint">{range}</p>
      </div>

      <div className="mt-3 flex items-center gap-4">
        <div className="relative h-16 w-16 shrink-0">
          <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90" aria-hidden>
            <circle cx="32" cy="32" r={r} fill="none" stroke="var(--color-bg)" strokeWidth="6" />
            {pct > 0 ? (
              <circle
                cx="32" cy="32" r={r} fill="none"
                stroke={tone.stroke} strokeWidth="6" strokeLinecap="round"
                strokeDasharray={`${c * Math.min(1, adherence.overall)} ${c}`}
              />
            ) : null}
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-sm font-bold tabular-nums">{pct}%</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className={`flex items-center gap-2 text-lg font-bold leading-tight ${tone.text}`}>
            {t.common.signal[adherence.signal]}
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-label={d.statusInfo}
              className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-line text-[10px] font-semibold text-ink-faint hover:text-ink"
            >
              i
            </button>
          </p>
          {open ? <p className="mt-1 text-xs leading-snug text-ink-faint">{d.statusInfo}</p> : null}
        </div>
      </div>

      {nudge ? <p className="mt-3 rounded-lg bg-risk-soft px-3 py-2 text-xs leading-snug text-risk">{nudge}</p> : null}

      <ul className="mt-3 grid grid-cols-4 gap-2">
        {parts.map((p) => (
          <li key={p.label}>
            <div className="h-1.5 overflow-hidden rounded-full bg-bg">
              <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round(p.value * 100)}%` }} />
            </div>
            <p className="mt-1 truncate text-[10px] text-ink-faint">{p.label}</p>
          </li>
        ))}
      </ul>

      <div className="mt-4">
        <TodayWeekStrip today={today} workoutDays={workoutDays} />
      </div>

      <div className="mt-4 grid grid-cols-3 divide-x divide-line border-t border-line pt-3">
        <Stat href="/workout" label={d.workouts} value={String(done)} unit={`/ ${planned || 3}`} />
        <Stat href="/progress" label={d.streak} value={String(streak)} unit={streak === 1 ? d.day : d.days} />
        <Stat href="/today?week=current#weekly-report" label={t.common.trainingLoad.short} value={String(load.this_week)} unit={deltaText} unitTone={deltaTone} />
      </div>
    </Card>
  );
}

// ---------- everything else ----------

/** A quiet one-line link row for a `divide-y` list: icon, label, optional meta, chevron. */
export function LinkRow({ href, icon, label, meta }: { href: string; icon: string; label: string; meta?: string }) {
  return (
    <li>
      <Link href={href} className="flex items-center gap-3 px-4 py-3 hover:bg-bg">
        <span className="w-6 text-center" aria-hidden>{icon}</span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{label}</span>
        {meta ? <span className="shrink-0 text-xs tabular-nums text-ink-faint">{meta}</span> : null}
        <span className="text-lg text-ink-faint" aria-hidden>›</span>
      </Link>
    </li>
  );
}
