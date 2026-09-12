"use client";
import Link from "next/link";
import { useState } from "react";
import type { Signal } from "@/lib/types";
import type { AdherenceResult, Macros } from "@healthapp/shared";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { parseDay, weekDaysOf } from "@/lib/week";
import type { ClientWorkoutDay, SessionSummaryRow } from "@/lib/types";
import { LogoMark } from "./logo";
import { TrainingLoadBadge } from "./training-load";
import { Card } from "./ui";

// The Today dashboard, phone-first: a week strip on top, the brand mark as
// the "mascot" with this week's standing under it, one row for the workout
// that matters right now, then a grid of small tiles. Everything below the
// grid (weekly summary, training load, habits, check-in) is the detail.

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
              className={`flex flex-col items-center gap-1 rounded-xl py-2 ${
                isToday ? "bg-accent text-accent-fg shadow-sm" : trained ? "bg-accent-soft text-accent-ink" : "bg-surface text-ink-faint"
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

const SIGNAL_TONE: Record<Signal, string> = {
  on_track: "text-accent-ink",
  needs_attention: "text-warn",
  at_risk: "text-risk",
};

/** The mark, then the week's standing as one line — "On track (82%)" — with the reason behind an (i). */
export function StatusHero({ adherence }: { adherence: AdherenceResult }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const pct = Math.round(adherence.overall * 100);
  return (
    <div className="relative flex flex-col items-center px-4 pb-2 pt-6 text-center">
      <div className="pointer-events-none absolute inset-x-0 top-0 mx-auto h-40 w-40 rounded-full bg-accent-soft blur-3xl" aria-hidden />
      <LogoMark className="relative h-28 w-28 drop-shadow-lg" />
      <p className={`relative mt-4 text-2xl font-bold tracking-tight ${SIGNAL_TONE[adherence.signal]}`}>
        {t.common.signal[adherence.signal]}
        <span className="text-ink">&nbsp;({pct}%)</span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={t.clientApp.today.statusInfo}
          className="ml-2 inline-flex h-6 w-6 items-center justify-center rounded-full border border-line align-middle text-xs font-semibold text-ink-faint hover:text-ink"
        >
          i
        </button>
      </p>
      {open ? (
        <p className="relative mt-2 max-w-sm text-xs leading-snug text-ink-soft">
          {adherence.reason}
          <span className="mt-1 block text-ink-faint">{t.clientApp.today.statusInfo}</span>
        </p>
      ) : null}
    </div>
  );
}

/** One row: the session finished today (with its load), else the next workout with a Start chevron. */
export function WorkoutRow({ doneToday, next }: { doneToday: SessionSummaryRow | null; next: ClientWorkoutDay | null }) {
  const { t, locale } = useI18n();
  const d = t.clientApp.today;
  const nf = new Intl.NumberFormat(locale === "ro" ? "ro-RO" : "en-GB");
  if (doneToday) {
    const min = doneToday.load.duration_min;
    return (
      <Link href={doneToday.day_id ? `/workout/${doneToday.day_id}` : "/workout"} className="block">
        <Card className="flex items-center gap-3 hover:border-accent">
          <span className="text-2xl" aria-hidden>🏋️</span>
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-bold tabular-nums">
              {min !== null ? <span>{min} min</span> : null}
              {min !== null ? <span className="text-ink-faint">·</span> : null}
              <span>{nf.format(doneToday.volume_kg)} kg</span>
              <TrainingLoadBadge load={doneToday.load} showLabel={false} />
            </p>
            <p className="mt-0.5 truncate text-xs text-ink-faint">
              {doneToday.day_name} · {d.doneToday}
            </p>
          </div>
          <span className="text-lg text-ink-faint" aria-hidden>›</span>
        </Card>
      </Link>
    );
  }
  if (!next) {
    return (
      <Card>
        <p className="text-sm text-ink-soft">{d.noProgram}</p>
      </Card>
    );
  }
  return (
    <Link href={`/workout/${next.day_id}/log`} className="block">
      <Card className="flex items-center gap-3 hover:border-accent">
        <span className="text-2xl" aria-hidden>🏋️</span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold">{next.day_name}</p>
          <p className="mt-0.5 truncate text-xs text-ink-faint">
            {d.nextUp} · {fill(t.clientApp.workout.exercisesCount, { count: next.exercises.length })}
          </p>
        </div>
        <span className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg">{d.start} ›</span>
      </Card>
    </Link>
  );
}

/** A small stat tile: icon + label on top, big number under, a 🏆 when the goal is met. */
export function Tile({ href, icon, label, value, unit, done = false, children }: {
  href: string;
  icon: string;
  label: string;
  value?: string;
  unit?: string;
  done?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <Link href={href} className="block min-w-0">
      <Card className="h-full hover:border-accent">
        <div className="flex items-center justify-between gap-2">
          <p className="flex min-w-0 items-center gap-1.5 text-sm font-semibold">
            <span aria-hidden>{icon}</span>
            <span className="truncate">{label}</span>
          </p>
          {done ? <span aria-hidden className="shrink-0">🏆</span> : null}
        </div>
        {value !== undefined ? (
          <p className="mt-2 text-2xl font-bold tabular-nums leading-none">
            {value}
            {unit ? <span className="ml-1 text-sm font-medium text-ink-faint">{unit}</span> : null}
          </p>
        ) : null}
        {children}
      </Card>
    </Link>
  );
}

/** Calories as a ring, protein and carbs as the two lines under it — the reference's "531/350" tile. */
export function NutritionTile({ totals, target }: { totals: Macros; target: Macros }) {
  const { t, locale } = useI18n();
  const nf = new Intl.NumberFormat(locale === "ro" ? "ro-RO" : "en-GB");
  const ratio = target.kcal > 0 ? Math.min(1, totals.kcal / target.kcal) : 0;
  const over = target.kcal > 0 && totals.kcal > target.kcal * 1.05;
  const r = 26;
  const c = 2 * Math.PI * r;
  const rows: { label: string; value: number; target: number; tone: string }[] = [
    { label: "kcal", value: totals.kcal, target: target.kcal, tone: over ? "text-warn" : "text-risk" },
    { label: t.common.macros.protein, value: totals.protein, target: target.protein, tone: "text-warn" },
    { label: t.common.macros.carbs, value: totals.carbs, target: target.carbs, tone: "text-accent-ink" },
  ];
  return (
    <Link href="/food" className="block min-w-0">
      <Card className="h-full hover:border-accent">
        <div className="flex items-center gap-3">
          <svg viewBox="0 0 64 64" className="h-16 w-16 shrink-0 -rotate-90" role="img" aria-label={`${Math.round(totals.kcal)} / ${Math.round(target.kcal)} kcal`}>
            <circle cx="32" cy="32" r={r} fill="none" stroke="var(--color-bg)" strokeWidth="8" />
            {ratio > 0 ? (
              <circle
                cx="32" cy="32" r={r} fill="none"
                stroke={over ? "var(--color-warn)" : "var(--color-accent)"}
                strokeWidth="8" strokeLinecap="round"
                strokeDasharray={`${c * ratio} ${c}`}
              />
            ) : null}
          </svg>
          <p className="min-w-0 text-sm font-semibold">
            <span aria-hidden>🍽️</span> {t.common.nav.nutrition}
          </p>
        </div>
        <dl className="mt-3 space-y-1">
          {rows.map((row) => (
            <div key={row.label} className="flex items-baseline justify-between gap-2 text-sm">
              <dd className={`font-bold tabular-nums ${row.tone}`}>
                {nf.format(Math.round(row.value))}
                <span className="font-medium text-ink-faint">/{nf.format(Math.round(row.target))}</span>
              </dd>
              <dt className="text-xs text-ink-faint">{row.label}</dt>
            </div>
          ))}
        </dl>
      </Card>
    </Link>
  );
}
