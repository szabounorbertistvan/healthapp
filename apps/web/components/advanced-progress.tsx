"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  EXERCISE_RANGES,
  FITNESS_SCORE_MIN_WORKOUTS,
  ONE_RM_MAX_REPS,
  type BodyMetric,
  type BodyProgress,
  type ExerciseSessionEntry,
  type ExerciseStats,
  type LiftComparison,
  type MeasurementComparison,
  type PeriodBucket,
  type PeriodChange,
  type ProgressInsight,
  type ProgressRange,
  type StrengthHighlight,
  type TrainingProgress,
} from "@healthapp/shared";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { useUnits } from "@/lib/units/client";
import { progressHref, PROGRESS_TABS, type ProgressState, type ProgressTab } from "@/lib/progress-params";
import { FIELD, SMALL_BUTTON } from "@/lib/form-classes";
import type { FitnessScoreView } from "@/lib/fitness-score-data";
import { MetricChart, PointsChart } from "./exercise-analytics";
import { Card } from "./ui";

/**
 * The Advanced Progress dashboard's client half. It formats; it never
 * computes. Every figure arrives already folded on the server
 * (packages/shared/progress over the person's own rows), exact and unrounded
 * — rounding happens here, at the last step, in the reader's unit.
 *
 * State lives in the URL (lib/progress-params), so the range and the tabs are
 * plain links: a server render per view, nothing to hydrate but the charts.
 */

function useFormat() {
  const { t, locale } = useI18n();
  const u = useUnits();
  const tag = locale === "ro" ? "ro-RO" : "en-GB";
  const n0 = new Intl.NumberFormat(tag, { maximumFractionDigits: 0 });
  const n1 = new Intl.NumberFormat(tag, { maximumFractionDigits: 1 });
  const df = new Intl.DateTimeFormat(tag, { day: "numeric", month: "short", year: "numeric" });
  return {
    t,
    u,
    a: t.clientApp.advancedProgress,
    count: (v: number) => n0.format(v),
    one: (v: number) => n1.format(v),
    pct: (v: number) => n1.format(Math.abs(v)),
    kg: (kg: number) => `${n1.format(u.weightValue(kg))} ${u.weightUnit}`,
    bigKg: (kg: number) => `${n0.format(u.weightValue(kg))} ${u.weightUnit}`,
    cm: (cm: number) => `${n1.format(u.lengthValue(cm))} ${u.lengthUnit}`,
    date: (day: string) => df.format(dayDate(day)),
  };
}

// ---------- navigation ----------

export function RangeTabs({ state }: { state: ProgressState }) {
  return <RangeLinks value={state.range} hrefFor={(range) => progressHref({ ...state, range })} />;
}

/**
 * The 7 / 30 / 90 / 365 / all-time links — one row for every dashboard that
 * shares these ranges (/progress, /food trends), each supplying its own URL.
 */
export function RangeLinks({ value, hrefFor }: { value: ProgressRange; hrefFor: (range: ProgressRange) => string }) {
  const { a } = useFormat();
  const label = (r: ProgressRange) =>
    r === null ? a.rangeAll : r === 7 ? a.range7 : r === 30 ? a.range30 : r === 90 ? a.range90 : a.range365;
  return (
    <nav className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none]" aria-label={a.rangeLabel}>
      {EXERCISE_RANGES.map((r) => {
        const on = r === value;
        return (
          <Link
            key={String(r)}
            href={hrefFor(r)}
            scroll={false}
            aria-current={on ? "page" : undefined}
            className={`h-9 shrink-0 rounded-full px-3.5 text-[12.5px] font-semibold leading-9 tabular-nums ${
              on ? "bg-accent text-accent-fg" : "bg-surface text-ink-soft hover:text-ink"
            }`}
          >
            {label(r)}
          </Link>
        );
      })}
    </nav>
  );
}

export function SectionTabs({ state }: { state: ProgressState }) {
  const { a } = useFormat();
  const label: Record<ProgressTab, string> = { body: a.tabBody, strength: a.tabStrength, consistency: a.tabConsistency, goals: a.tabGoals };
  return (
    <nav className="grid grid-cols-4 gap-1 rounded-2xl bg-surface p-1" aria-label={a.tabsLabel}>
      {PROGRESS_TABS.map((tab) => {
        const on = tab === state.tab;
        return (
          <Link
            key={tab}
            href={progressHref({ ...state, tab })}
            scroll={false}
            aria-current={on ? "page" : undefined}
            className={`truncate rounded-xl px-1 py-2.5 text-center text-[12px] font-semibold sm:text-[13px] ${
              on ? "bg-bg text-ink shadow-sm" : "text-ink-soft hover:text-ink"
            }`}
          >
            {label[tab]}
          </Link>
        );
      })}
    </nav>
  );
}

/** One line under the range: what the arrows compare against, or why nothing is compared. */
export function ComparisonNote({ range, hasPrevious }: { range: ProgressRange; hasPrevious: boolean }) {
  const { a } = useFormat();
  const text = range === null ? a.allTimeNoCompare : hasPrevious ? fill(a.vsPrevious, { days: range }) : a.noPrevious;
  return <p className="text-[12px] text-ink-faint">{text}</p>;
}

// ---------- shared pieces ----------

/**
 * A figure and, when there is something to compare it with, where it came
 * from. The tone is neutral on purpose: a lower body weight or a lighter week
 * is not good or bad by itself, so only the sign carries direction.
 */
export function Figure({
  label,
  value,
  change,
  format,
  hint,
}: {
  label: string;
  value: string;
  change?: PeriodChange | null;
  format?: (v: number) => string;
  hint?: string;
}) {
  const f = useFormat();
  const show = change && format;
  return (
    <div className="rounded-2xl bg-surface px-4 py-3.5">
      <p className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-faint">{label}</p>
      <p className="mt-1 font-display text-[22px] font-extrabold tabular-nums leading-tight">{value}</p>
      {show ? (
        <p className="mt-1 text-[11.5px] tabular-nums text-ink-faint">
          {fill(f.a.previousValue, { value: format(change.previous) })}
          {" · "}
          <span className={change.delta > 0 ? "font-semibold text-accent-ink" : "font-semibold text-ink-soft"}>
            {change.delta > 0 ? "+" : change.delta < 0 ? "−" : "±"}
            {format(Math.abs(change.delta))}
            {change.pct !== null && change.delta !== 0 ? ` (${change.delta > 0 ? "+" : "−"}${f.pct(change.pct)}%)` : ""}
          </span>
        </p>
      ) : null}
      {hint ? <p className="mt-1 text-[10.5px] text-ink-faint">{hint}</p> : null}
    </div>
  );
}

export function Eyebrow({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{children}</p>
      {aside ? <div className="text-[11px] text-ink-faint">{aside}</div> : null}
    </div>
  );
}

/**
 * Bars per week or month. Bars, not a line, for the reason WeeklyBars gives:
 * a line through an empty week invents a slope. An empty bucket keeps a
 * hairline so the gap reads as a gap.
 */
function Bars({
  title,
  unit,
  items,
  value,
  format,
}: {
  title: string;
  unit: "week" | "month";
  items: PeriodBucket[];
  value: (b: PeriodBucket) => number;
  format: (v: number) => string;
}) {
  const f = useFormat();
  const peak = Math.max(0, ...items.map(value));
  const first = items[0];
  const last = items[items.length - 1];
  return (
    <Card plain>
      <Eyebrow aside={unit === "week" ? f.a.perWeek : f.a.perMonth}>{title}</Eyebrow>
      {peak === 0 || !first || !last ? (
        <p className="mt-3 text-[13px] text-ink-faint">{f.a.noWorkouts}</p>
      ) : (
        <>
          <div className="mt-3.5 flex h-28 items-end gap-[3px]">
            {items.map((b) => {
              const v = value(b);
              return (
                <div key={b.start} className="flex h-full flex-1 items-end" title={`${f.date(b.start)} · ${format(v)}`}>
                  <div
                    className={`w-full rounded-t-[4px] ${b.workouts === 0 ? "bg-line" : "bg-accent"}`}
                    style={{ height: b.workouts === 0 ? "2px" : `${Math.max((v / peak) * 100, 4)}%` }}
                  />
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-2 text-[11px] tabular-nums text-ink-faint">
            <span>{f.date(first.start)}</span>
            <span className="font-bold text-accent-ink">{format(peak)}</span>
            <span>{f.date(last.start)}</span>
          </div>
        </>
      )}
    </Card>
  );
}

// ---------- insights ----------

export function InsightsCard({ insights, names }: { insights: ProgressInsight[]; names: Record<string, string> }) {
  const f = useFormat();
  const a = f.a;
  const sentence = (i: ProgressInsight): string => {
    switch (i.key) {
      case "one_rm_change":
        return fill(i.pct > 0 ? a.insightOneRmUp : a.insightOneRmDown, { exercise: names[i.exercise_id] ?? "—", pct: f.pct(i.pct) });
      case "volume_change":
        return fill(i.pct > 0 ? a.insightVolumeUp : a.insightVolumeDown, { pct: f.pct(i.pct) });
      case "load_change":
        return fill(i.pct > 0 ? a.insightLoadUp : a.insightLoadDown, { pct: f.pct(i.pct) });
      case "active_days":
        return fill(a.insightActiveDays, { current: i.current, previous: i.previous });
      case "week_workouts":
        return fill(a.insightWeekWorkouts, { current: i.current, previous: i.previous });
      case "weight_change":
        return fill(i.basis === "within" ? a.insightWeightWithin : a.insightWeight, {
          delta: `${i.delta_kg > 0 ? "+" : "−"}${f.one(Math.abs(f.u.weightValue(i.delta_kg)))}`,
          unit: f.u.weightUnit,
        });
      case "prs":
        return i.count === 1 ? a.insightPr : fill(a.insightPrs, { count: i.count });
    }
  };
  return (
    <Card plain>
      <Eyebrow>{a.insights}</Eyebrow>
      {insights.length === 0 ? (
        <p className="mt-2.5 text-[13px] text-ink-faint">{a.insightsEmpty}</p>
      ) : (
        <ul className="mt-2.5 space-y-2">
          {insights.map((i) => (
            <li key={i.key + ("exercise_id" in i ? i.exercise_id : "")} className="flex gap-2.5 text-[13.5px] leading-snug">
              <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
              <span>{sentence(i)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ---------- body ----------

/** Weight and every circumference: the latest figure, its comparison, and the line. */
export function BodyTrends({ body, chartsLocked }: { body: BodyProgress; chartsLocked: ReactNode }) {
  const f = useFormat();
  const a = f.a;
  const circ = a.circ as Record<string, string>;
  const keys = Object.keys(body.circumferences);
  return (
    <div className="space-y-4">
      <BodyCard title={a.bodyWeight} metric={body.weight} kind="weight" chartsLocked={chartsLocked} />
      {keys.length === 0 ? (
        <Card plain>
          <Eyebrow>{a.circumferences}</Eyebrow>
          <p className="mt-2.5 text-[13px] text-ink-faint">{a.noCircumferences}</p>
        </Card>
      ) : (
        keys.map((key) => (
          <BodyCard key={key} title={circ[key] ?? key} metric={body.circumferences[key]!} kind="length" chartsLocked={chartsLocked} />
        ))
      )}
    </div>
  );
}

function BodyCard({
  title,
  metric,
  kind,
  chartsLocked,
}: {
  title: string;
  metric: BodyMetric;
  kind: "weight" | "length";
  chartsLocked: ReactNode;
}) {
  const f = useFormat();
  const toUnit = kind === "weight" ? f.u.weightValue : f.u.lengthValue;
  const unit = kind === "weight" ? f.u.weightUnit : f.u.lengthUnit;
  const format = kind === "weight" ? f.kg : f.cm;
  return (
    <div className="space-y-2.5">
      <Figure
        label={title}
        value={metric.latest ? format(metric.latest.value) : "—"}
        change={metric.change}
        format={format}
        hint={metric.latest ? fill(f.a.latestWeighIn, { date: f.date(metric.latest.day) }) : f.a.noWeighIns}
      />
      {metric.within && metric.series[0] ? (
        <p className="px-1 text-[12px] tabular-nums text-ink-soft">
          {fill(f.a.sinceStart, { date: f.date(metric.series[0].day) })}{" "}
          <b className="font-semibold text-ink">{signed(metric.within, format, f.pct)}</b>
        </p>
      ) : null}
      {chartsLocked ?? (
        <PointsChart title={title} unit={unit} points={metric.series.map((p) => ({ day: p.day, value: toUnit(p.value) }))} />
      )}
    </div>
  );
}

// ---------- strength ----------

export function StrengthOverview({
  training,
  highlights,
  names,
  fitness,
  buckets,
  chartsLocked,
}: {
  training: TrainingProgress;
  highlights: StrengthHighlight[];
  names: Record<string, string>;
  fitness: FitnessScoreView | null;
  buckets: { unit: "week" | "month"; items: PeriodBucket[] };
  chartsLocked: ReactNode;
}) {
  const f = useFormat();
  const a = f.a;
  const c = training.changes;
  const cur = training.current;
  const fs = fitness?.current;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <Figure label={a.volume} value={f.bigKg(cur.volume_kg)} change={c?.volume_kg} format={f.bigKg} />
        <Figure
          label={a.trainingLoad}
          value={f.count(cur.total_load)}
          change={c?.total_load}
          format={f.count}
          hint={a.trainingLoadHint}
        />
        <Figure
          label={a.avgLoad}
          value={cur.avg_load === null ? "—" : f.one(cur.avg_load)}
          change={c?.avg_load}
          format={f.one}
        />
        {fitness && fs ? (
          <Figure
            label={a.fitnessScore}
            value={fs.score === null ? "—" : String(fs.score)}
            // The trend against the previous 28 days is the same gate the
            // Today card and /fitness-score use.
            change={
              chartsLocked === null && fitness.trend.delta !== null
                ? { current: fitness.trend.current!, previous: fitness.trend.previous!, delta: fitness.trend.delta, pct: null }
                : null
            }
            format={f.count}
            hint={fs.score === null ? fill(a.fitnessBuilding, { count: FITNESS_SCORE_MIN_WORKOUTS }) : a.fitnessScoreHint}
          />
        ) : null}
      </div>

      {/* What the two scores are and are not — the formulas themselves are
          spelled out, component by component, on /fitness-score. */}
      <details className="group rounded-2xl bg-surface px-4 py-3">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[13px] font-semibold [&::-webkit-details-marker]:hidden">
          {a.aboutScores}
          <span aria-hidden className="text-ink-faint transition-transform group-open:rotate-180">⌄</span>
        </summary>
        <div className="mt-2 space-y-1.5 text-[12.5px] leading-relaxed text-ink-soft">
          <p>{a.aboutLoad}</p>
          <p>{fill(a.aboutFitness, { count: FITNESS_SCORE_MIN_WORKOUTS })}</p>
          <p>{a.aboutRecovery}</p>
          <Link href="/fitness-score" className="inline-block font-semibold text-accent-ink hover:underline">
            {a.fitnessBreakdown} →
          </Link>
        </div>
      </details>

      <Card plain className="overflow-hidden p-0">
        <div className="px-5 pb-1 pt-[18px]">
          <Eyebrow>{a.mainLifts}</Eyebrow>
          <p className="mt-1.5 text-[12.5px] text-ink-faint">{a.mainLiftsHint}</p>
        </div>
        {highlights.length === 0 ? (
          <p className="px-5 pb-[18px] pt-2 text-[13px] text-ink-faint">{a.noMainLifts}</p>
        ) : (
          <ul className="mt-1 divide-y divide-line/60">
            {highlights.slice(0, 6).map((h) => (
              <li key={h.exercise_id} className="flex items-center justify-between gap-3 px-5 py-3">
                <Link href={`/exercises/${h.exercise_id}`} className="min-w-0 truncate text-[14px] font-semibold hover:text-accent-ink">
                  {names[h.exercise_id] ?? "—"}
                </Link>
                <span className="shrink-0 text-right text-[12.5px] tabular-nums">
                  <span className="text-ink-faint">{f.kg(h.change.previous)} → </span>
                  <b>{f.kg(h.change.current)}</b>
                  {h.change.pct !== null ? (
                    <span className={`ml-1.5 font-semibold ${h.change.delta > 0 ? "text-accent-ink" : "text-ink-soft"}`}>
                      {h.change.delta > 0 ? "+" : h.change.delta < 0 ? "−" : "±"}
                      {f.pct(h.change.pct)}%
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {chartsLocked ?? (
        <div className="grid gap-4 @3xl:grid-cols-2">
          <Bars title={a.volume} unit={buckets.unit} items={buckets.items} value={(b) => b.volume_kg} format={f.bigKg} />
          <Bars title={a.trainingLoad} unit={buckets.unit} items={buckets.items} value={(b) => b.load} format={f.count} />
        </div>
      )}
    </div>
  );
}

/**
 * One lift, chosen from the ones trained in the period: its bests inside the
 * period (exerciseStats over those sessions) and the same three charts the
 * exercise page draws, through the same MetricChart.
 */
export function ExerciseProgress({
  state,
  options,
  selected,
  sessions,
  stats,
  comparison,
  lastDay,
  todayIso,
  chartsLocked,
}: {
  state: ProgressState;
  options: { id: string; name: string }[];
  selected: string | null;
  /** The chosen lift's sessions inside the period. */
  sessions: ExerciseSessionEntry[];
  stats: ExerciseStats;
  /** The lift in this period against the previous one (liftComparison). */
  comparison: LiftComparison;
  /** Local day of the newest session of the lift, in or before the period. */
  lastDay: string | null;
  todayIso: string;
  chartsLocked: ReactNode;
}) {
  const f = useFormat();
  const a = f.a;
  const d = f.t.clientApp.exerciseDetail;
  if (options.length === 0 || selected === null) {
    return (
      <Card plain>
        <Eyebrow>{a.exercise}</Eyebrow>
        <p className="mt-2.5 text-[13px] text-ink-faint">{a.noExercises}</p>
      </Card>
    );
  }
  return (
    <section className="space-y-3">
      <Eyebrow aside={<Link href={`/exercises/${selected}`} className="font-semibold text-accent-ink hover:underline">{a.fullHistory} →</Link>}>
        {a.exercise}
      </Eyebrow>
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
        {options.map((o) => {
          const on = o.id === selected;
          return (
            <Link
              key={o.id}
              href={progressHref({ ...state, exercise: o.id })}
              scroll={false}
              aria-current={on ? "true" : undefined}
              className={`h-8 shrink-0 whitespace-nowrap rounded-full px-3 text-[12.5px] font-semibold leading-8 ${
                on ? "bg-accent text-accent-fg" : "bg-surface text-ink-soft hover:text-ink"
              }`}
            >
              {o.name}
            </Link>
          );
        })}
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{a.inThisPeriod}</p>
        <p className="text-[11.5px] text-ink-faint">
          {lastDay ? fill(a.lastPerformed, { date: f.date(lastDay) }) : a.notPerformed}
        </p>
      </div>
      {stats.sessions === 0 ? <p className="text-[13px] text-ink-faint">{a.liftNotInPeriod}</p> : null}
      {/* Each figure is compared with the previous period only when the lift
          was done in both, and weights only when both were done with load. */}
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <Figure
          label={d.bestWeight}
          value={stats.best_weight_kg === null ? "—" : f.kg(stats.best_weight_kg)}
          change={comparison.best_weight_kg}
          format={f.kg}
        />
        <Figure
          label={d.bestReps}
          value={stats.best_reps === null ? "—" : String(stats.best_reps)}
          change={comparison.best_reps}
          format={f.count}
        />
        <Figure
          label={d.estimated1rm}
          value={stats.best_1rm === null ? "—" : f.kg(stats.best_1rm)}
          change={comparison.best_1rm}
          format={f.kg}
          hint={a.estimatedNotTested}
        />
        <Figure
          label={d.totalVolume}
          value={f.bigKg(stats.total_volume_kg)}
          change={comparison.volume_kg}
          format={f.bigKg}
        />
      </div>
      {comparison.mixed ? <p className="text-[12px] text-ink-faint">{a.liftMixed}</p> : null}
      {chartsLocked ?? (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-[repeat(auto-fill,minmax(280px,1fr))]">
          {stats.bodyweight ? (
            <MetricChart title={d.maxReps} metric="reps" sessions={sessions} range={state.range} todayIso={todayIso} />
          ) : (
            <>
              <MetricChart title={d.chart1rm} metric="one_rm" sessions={sessions} range={state.range} todayIso={todayIso} hint={fill(d.oneRmHint, { reps: ONE_RM_MAX_REPS })} />
              <MetricChart title={d.chartWeight} metric="weight" sessions={sessions} range={state.range} todayIso={todayIso} />
              <MetricChart title={d.maxReps} metric="reps" sessions={sessions} range={state.range} todayIso={todayIso} hint={a.repsAnyLoad} />
              <MetricChart title={d.chartVolume} metric="volume" sessions={sessions} range={state.range} todayIso={todayIso} />
            </>
          )}
        </div>
      )}
    </section>
  );
}

// ---------- consistency ----------

export function ConsistencyOverview({
  training,
  streak,
  plannedPerWeek,
  thisWeek,
  buckets,
  chartsLocked,
}: {
  training: TrainingProgress;
  streak: { current: number; longest: number } | null;
  /** Days in the program followed now; null without one — then nothing is "missed". */
  plannedPerWeek: number | null;
  /** Workouts logged in the current calendar week. */
  thisWeek: number;
  buckets: { unit: "week" | "month"; items: PeriodBucket[] };
  chartsLocked: ReactNode;
}) {
  const f = useFormat();
  const a = f.a;
  const c = training.changes;
  const cur = training.current;
  const adHoc = cur.workouts - cur.from_program;
  return (
    <div className="space-y-4">
      {/* The current program's week, never applied to past weeks: an older
          program may have planned a different number, and weeks before any
          program planned nothing — so nothing in the period counts as missed. */}
      <Card plain>
        <Eyebrow>{a.thisWeek}</Eyebrow>
        <p className="mt-1.5 font-display text-[22px] font-extrabold tabular-nums leading-tight">
          {plannedPerWeek === null
            ? fill(thisWeek === 1 ? a.thisWeekOne : a.thisWeekMany, { count: thisWeek })
            : fill(a.thisWeekOfPlan, { done: thisWeek, planned: plannedPerWeek })}
        </p>
        <p className="mt-1 text-[12px] text-ink-faint">
          {plannedPerWeek === null ? a.noProgramTarget : fill(a.planTargetHint, { planned: plannedPerWeek })}
        </p>
      </Card>

      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-3">
        <Figure label={a.workouts} value={f.count(cur.workouts)} change={c?.workouts} format={f.count} />
        <Figure label={a.workoutsPerWeek} value={f.one(cur.workouts_per_week)} change={c?.workouts_per_week} format={f.one} />
        <Figure
          label={a.activeWeeks}
          value={fill(a.weeksOf, { active: cur.active_weeks, weeks: cur.weeks })}
          change={c?.active_weeks}
          format={f.count}
        />
        <Figure label={a.activeDays} value={f.count(cur.active_days)} change={c?.active_days} format={f.count} />
        <Figure
          label={a.medianDuration}
          value={cur.median_minutes === null ? "—" : `${f.count(cur.median_minutes)} min`}
          change={c?.median_minutes}
          format={(v) => `${f.count(v)} min`}
          hint={
            cur.workouts === 0
              ? undefined
              : cur.timed < cur.workouts
                ? fill(a.timedOf, { timed: cur.timed, workouts: cur.workouts })
                : undefined
          }
        />
        <Figure
          label={a.fromProgram}
          value={f.count(cur.from_program)}
          hint={cur.workouts > 0 ? fill(a.adHocCount, { count: adHoc }) : undefined}
        />
        <Figure label={a.prsInPeriod} value={f.count(cur.prs)} change={c?.prs} format={f.count} />
        {streak ? (
          <>
            <Figure label={a.currentStreak} value={`${streak.current} ${a.daysUnit}`} />
            <Figure label={a.longestStreak} value={`${streak.longest} ${a.daysUnit}`} />
          </>
        ) : null}
      </div>
      {chartsLocked ?? (
        <Bars title={a.workoutsChart} unit={buckets.unit} items={buckets.items} value={(b) => b.workouts} format={f.count} />
      )}
      <Link href="/streak" className="inline-block text-[12.5px] font-semibold text-accent-ink hover:underline">
        {a.streakCalendar} →
      </Link>
    </div>
  );
}

/**
 * "+1.2 kg (+1.5%)": the delta in the reader's unit, the percentage only when
 * there is one (periodChange leaves it null against a zero) and the delta is
 * not nothing.
 */
function signed(change: PeriodChange, format: (v: number) => string, pct: (v: number) => string): string {
  const sign = change.delta > 0 ? "+" : change.delta < 0 ? "−" : "±";
  const p = change.pct !== null && change.delta !== 0 ? ` (${sign}${pct(change.pct)}%)` : "";
  return `${sign}${format(Math.abs(change.delta))}${p}`;
}

// ---------- two dates ----------

/**
 * Two weigh-in days side by side. A plain GET form over the page's own URL
 * state, so it works before the page hydrates and the choice survives a
 * reload. Only days with a measurement are offered; a metric recorded on one
 * of the two days alone is named, never compared against nothing.
 */
export function MeasurementCompare({
  state,
  days,
  from,
  to,
  comparison,
}: {
  state: ProgressState;
  /** Every day with a measurement this plan shows, oldest first. */
  days: string[];
  from: string | null;
  to: string | null;
  comparison: MeasurementComparison | null;
}) {
  const f = useFormat();
  const a = f.a;
  const circ = a.circ as Record<string, string>;
  const labelOf = (key: string) => (key === "weight" ? a.bodyWeight : (circ[key] ?? key));
  if (days.length < 2) {
    return (
      <Card plain>
        <Eyebrow>{a.compareDates}</Eyebrow>
        <p className="mt-2.5 text-[13px] text-ink-faint">{a.compareNeedsTwo}</p>
      </Card>
    );
  }
  const newestFirst = [...days].reverse();
  return (
    <Card plain>
      <Eyebrow>{a.compareDates}</Eyebrow>
      <form method="get" action="/progress" className="mt-3 grid grid-cols-[1fr_1fr] items-end gap-2.5 sm:grid-cols-[1fr_1fr_auto]">
        {state.range !== 30 ? <input type="hidden" name="range" value={state.range === null ? "all" : String(state.range)} /> : null}
        {state.exercise ? <input type="hidden" name="exercise" value={state.exercise} /> : null}
        <label className="text-[12px] font-semibold text-ink-soft">
          {a.compareFrom}
          <select name="from" defaultValue={from ?? undefined} className={`${FIELD} mt-1`}>
            {newestFirst.map((d) => (
              <option key={d} value={d}>{f.date(d)}</option>
            ))}
          </select>
        </label>
        <label className="text-[12px] font-semibold text-ink-soft">
          {a.compareTo}
          <select name="to" defaultValue={to ?? undefined} className={`${FIELD} mt-1`}>
            {newestFirst.map((d) => (
              <option key={d} value={d}>{f.date(d)}</option>
            ))}
          </select>
        </label>
        <button type="submit" className={`${SMALL_BUTTON} col-span-2 h-11 sm:col-span-1`}>{a.compareButton}</button>
      </form>
      {comparison === null ? (
        <p className="mt-3 text-[13px] text-ink-faint">{a.compareSameDay}</p>
      ) : comparison.deltas.length === 0 ? (
        <p className="mt-3 text-[13px] text-ink-faint">{a.compareNothingShared}</p>
      ) : (
        <table className="mt-3.5 w-full text-[13px] tabular-nums">
          <caption className="sr-only">
            {fill(a.compareCaption, { from: f.date(comparison.from), to: f.date(comparison.to) })}
          </caption>
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider text-ink-faint">
              <th scope="col" className="pb-1.5 font-semibold" />
              <th scope="col" className="pb-1.5 text-right font-semibold">{f.date(comparison.from)}</th>
              <th scope="col" className="pb-1.5 text-right font-semibold">{f.date(comparison.to)}</th>
              <th scope="col" className="pb-1.5 text-right font-semibold">{a.compareChange}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/60">
            {comparison.deltas.map((d) => {
              const format = d.key === "weight" ? f.kg : f.cm;
              return (
                <tr key={d.key}>
                  <th scope="row" className="py-2 text-left font-semibold">{labelOf(d.key)}</th>
                  <td className="py-2 text-right text-ink-soft">{format(d.from)}</td>
                  <td className="py-2 text-right text-ink-soft">{format(d.to)}</td>
                  <td className="py-2 text-right font-semibold">{signed(d.change, format, f.pct)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {comparison && comparison.oneSided.length > 0 ? (
        <p className="mt-2 text-[11.5px] text-ink-faint">
          {fill(a.compareOneSided, { list: comparison.oneSided.map(labelOf).join(", ") })}
        </p>
      ) : null}
    </Card>
  );
}

/** An ISO day as a local Date — never `new Date("2026-09-20")`, which is UTC midnight. */
function dayDate(day: string): Date {
  const [y = 1970, m = 1, d = 1] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
}
