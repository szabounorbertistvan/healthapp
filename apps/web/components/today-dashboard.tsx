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
import { TrainingLoadBadge } from "./training-load";
import { Card } from "./ui";

// The Today dashboard in three blocks: the checklist of what to do today
// (workout, food, habits, check-in — one row each, tap to go do it), the week
// card (score ring with its four parts, the Mon–Sun strip, three stats), and
// quiet links to everything else. The page lays them out in columns.

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

// ---------- today's plan ----------

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

/**
 * Everything the client is meant to do today as one list. The workout row is
 * the primary action (Start pill); food and check-in navigate; habits tick in
 * place, because ticking is the smallest and most repeated action in the app.
 */
export function TodayChecklist({ doneToday, next, nutrition, habits, checkIn, coached }: {
  doneToday: SessionSummaryRow | null;
  next: ClientWorkoutDay | null;
  nutrition: ClientDayNutrition;
  habits: ClientHabitRow[];
  checkIn: ClientCheckInState;
  /** False for someone training on their own — a solo client, or a coach. */
  coached: boolean;
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
    <Card plain className="overflow-hidden p-0">
      <p className="px-5 pt-[18px] text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{d.plan}</p>
      <ul className="mt-2 divide-y divide-line/60">
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
            right={
              <span className="inline-flex h-8 shrink-0 items-center gap-1 rounded-[11px] bg-accent pl-3.5 pr-2.5 text-[12.5px] font-bold text-accent-fg">
                {d.start}
                <NavIcon d={CHEVRON} className="h-3 w-3 [stroke-width:2.6]" />
              </span>
            }
          />
        ) : (
          <Row
            href={coached ? "/workout" : "/workout/build"}
            done={false}
            title={t.common.nav.training}
            sub={coached ? d.noProgram : d.noProgramSolo}
          />
        )}

        <Row href="/food" done={logged} title={t.common.nav.nutrition} sub={foodSub}>
          {kcalTarget > 0 ? (
            <div className="mt-2 h-[5px] overflow-hidden rounded-full bg-bg">
              <div className={`h-full rounded-full ${over ? "bg-warn" : "bg-accent"}`} style={{ width: `${ratio * 100}%` }} />
            </div>
          ) : null}
        </Row>

        <li className="px-5 py-3.5">
          <Link href="/habits" className="flex items-center gap-3.5">
            <Dot done={allHabits} />
            <span className={`min-w-0 flex-1 truncate text-[14.5px] font-semibold ${allHabits ? "text-ink-soft" : ""}`}>{t.common.nav.habits}</span>
            {habits.length > 0 ? (
              <span className="shrink-0 text-[12.5px] tabular-nums text-ink-faint">{habitsDone}/{habits.length}</span>
            ) : (
              <Chevron />
            )}
          </Link>
          {habits.length > 0 ? (
            <div className="mt-1.5 pl-10">
              <HabitTicks habits={habits} />
            </div>
          ) : (
            <p className="mt-0.5 pl-10 text-[12.5px] text-ink-faint">{d.noHabitsYet}</p>
          )}
        </li>

        <Row
          href="/check-in"
          done={checkIn.submitted}
          title={d.weeklyCheckIn}
          sub={checkIn.submitted ? d.checkInSubmitted : d.checkInNotSubmitted}
          right={checkIn.submitted ? undefined : <span className="shrink-0 rounded-full bg-warn-soft px-2.5 py-0.5 text-[11px] font-bold text-warn">{d.due}</span>}
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
