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
  const label: Record<ProgressTab, string> = { body: a.tabBody, strength: a.tabStrength, consistency: a.tabConsistency };
  return (
    <nav className="grid grid-cols-3 gap-1 rounded-2xl bg-surface p-1" aria-label={a.tabsLabel}>
      {PROGRESS_TABS.map((tab) => {
        const on = tab === state.tab;
        return (
          <Link
            key={tab}
            href={progressHref({ ...state, tab })}
            scroll={false}
            aria-current={on ? "page" : undefined}
            className={`rounded-xl py-2.5 text-center text-[13px] font-semibold ${
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
      case "weight_change":
        return fill(a.insightWeight, {
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
  todayIso,
  chartsLocked,
}: {
  state: ProgressState;
  options: { id: string; name: string }[];
  selected: string | null;
  /** The chosen lift's sessions inside the period. */
  sessions: ExerciseSessionEntry[];
  stats: ExerciseStats;
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
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{a.inThisPeriod}</p>
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <Figure label={d.bestWeight} value={stats.best_weight_kg === null ? "—" : f.kg(stats.best_weight_kg)} />
        <Figure label={d.bestReps} value={stats.best_reps === null ? "—" : String(stats.best_reps)} />
        <Figure label={d.estimated1rm} value={stats.best_1rm === null ? "—" : f.kg(stats.best_1rm)} />
        <Figure label={d.totalVolume} value={f.bigKg(stats.total_volume_kg)} />
      </div>
      {chartsLocked ?? (
        <div className="grid gap-3 sm:grid-cols-[repeat(auto-fill,minmax(280px,1fr))]">
          {stats.bodyweight ? (
            <MetricChart title={d.maxReps} metric="reps" sessions={sessions} range={state.range} todayIso={todayIso} />
          ) : (
            <>
              <MetricChart title={d.chart1rm} metric="one_rm" sessions={sessions} range={state.range} todayIso={todayIso} hint={fill(d.oneRmHint, { reps: ONE_RM_MAX_REPS })} />
              <MetricChart title={d.chartWeight} metric="weight" sessions={sessions} range={state.range} todayIso={todayIso} />
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
  buckets,
  chartsLocked,
}: {
  training: TrainingProgress;
  streak: { current: number; longest: number } | null;
  buckets: { unit: "week" | "month"; items: PeriodBucket[] };
  chartsLocked: ReactNode;
}) {
  const f = useFormat();
  const a = f.a;
  const c = training.changes;
  const cur = training.current;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-3">
        <Figure label={a.workouts} value={f.count(cur.workouts)} change={c?.workouts} format={f.count} />
        <Figure label={a.workoutsPerWeek} value={f.one(cur.workouts_per_week)} change={c?.workouts_per_week} format={f.one} />
        <Figure label={a.activeDays} value={f.count(cur.active_days)} change={c?.active_days} format={f.count} />
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

/** An ISO day as a local Date — never `new Date("2026-09-20")`, which is UTC midnight. */
function dayDate(day: string): Date {
  const [y = 1970, m = 1, d = 1] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
}
