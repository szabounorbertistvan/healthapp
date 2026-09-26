"use client";
import { useMemo, useState, type ReactNode } from "react";
import {
  EXERCISE_RANGES,
  metricSeries,
  ONE_RM_MAX_REPS,
  kgToDisplay,
  type ExerciseMetric,
  type ExerciseRangeDays,
  type ExerciseSessionEntry,
  type ExerciseStats,
  type MetricPoint,
  type RepRecord,
} from "@healthapp/shared";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { useUnits } from "@/lib/units/client";
import { Card } from "./ui";

/**
 * The numbers behind one lift: what you last did, your bests, the
 * progressions, the rep records and every completed session.
 *
 * The plan decides two things, and the page decides them — this component
 * never reads the plan. `chartsLocked` replaces the charts and rep records with
 * whatever the page renders there (the upgrade hint), and `historySessions` is
 * the part of the history the plan's window shows, with `historyLocked` under
 * it when some was held back. With the paywall off the page passes no lock and
 * every session. The summary always covers the whole history.
 *
 * All of it is computed server-side from stored rows (lib/exercise-analytics-data)
 * and handed down; this component only formats. The charts are inline SVG for
 * the same reason Sparkline is — one series each, and a chart library is a
 * large dependency to ship to a phone in a gym.
 */
export function ExerciseAnalytics({
  sessions,
  stats,
  records,
  initialRange,
  todayIso,
  truncated,
  historySessions = sessions,
  chartsLocked = null,
  historyLocked = null,
}: {
  sessions: ExerciseSessionEntry[];
  stats: ExerciseStats;
  records: RepRecord[];
  initialRange: ExerciseRangeDays;
  /** Passed from the server so the window is the reader's day, not the browser's. */
  todayIso: string;
  truncated: boolean;
  /** The sessions the history list shows — the plan's window of `sessions`. */
  historySessions?: ExerciseSessionEntry[];
  /** Rendered in place of the charts and rep records when the plan does not include them. */
  chartsLocked?: ReactNode;
  /** Rendered under the history when the plan's window held sessions back. */
  historyLocked?: ReactNode;
}) {
  const { t } = useI18n();
  const d = t.clientApp.exerciseDetail;
  const [range, setRange] = useState<ExerciseRangeDays>(initialRange);

  if (sessions.length === 0) {
    return (
      <Card plain className="mt-5">
        <p className="font-display text-lg font-bold">{d.noHistoryTitle}</p>
        <p className="mt-1.5 text-[13px] text-ink-soft">{d.noHistoryHint}</p>
      </Card>
    );
  }

  return (
    <>
      <PerformanceSummary stats={stats} truncated={truncated} />

      <section className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-lg font-bold tracking-tight">{d.progress}</h2>
          {chartsLocked ? null : <RangeTabs value={range} onChange={setRange} />}
        </div>
        {chartsLocked ? (
          <div className="mt-3">{chartsLocked}</div>
        ) : (
          <>
            <div className="mt-3 grid gap-3 sm:grid-cols-[repeat(auto-fill,minmax(300px,1fr))]">
              {stats.bodyweight ? (
                // Nothing was ever loaded: weight, volume and 1RM would be empty
                // lines, and the number that moves is reps.
                <MetricChart title={d.maxReps} metric="reps" sessions={sessions} range={range} todayIso={todayIso} />
              ) : (
                <>
                  <MetricChart title={d.chartWeight} metric="weight" sessions={sessions} range={range} todayIso={todayIso} />
                  <MetricChart title={d.chartVolume} metric="volume" sessions={sessions} range={range} todayIso={todayIso} />
                  <MetricChart title={d.chart1rm} metric="one_rm" sessions={sessions} range={range} todayIso={todayIso} hint={fill(d.oneRmHint, { reps: ONE_RM_MAX_REPS })} />
                </>
              )}
            </div>
            {records.length > 0 ? <RepRecords records={records} /> : null}
          </>
        )}
      </section>

      <section className="mt-6">
        <h2 className="font-display text-lg font-bold tracking-tight">{d.history}</h2>
        <p className="mt-1 text-[12.5px] text-ink-faint">{d.historyHint} {d.warmupNote}</p>
        <SessionHistory sessions={historySessions} />
        {historyLocked ? <div className="mt-3">{historyLocked}</div> : null}
      </section>
    </>
  );
}

/** The headline figures. Every one is derived from stored sets, never typed in. */
function PerformanceSummary({ stats, truncated }: { stats: ExerciseStats; truncated: boolean }) {
  const { t, locale } = useI18n();
  const u = useUnits();
  const d = t.clientApp.exerciseDetail;
  const last = stats.last?.sets ?? [];
  const topLast = last.reduce<{ weight_kg: number; reps: number } | null>(
    (best, s) => (best === null || s.weight_kg > best.weight_kg ? s : best),
    null,
  );

  return (
    <section className="mt-5">
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{d.summary}</h2>
      {stats.bodyweight ? (
        // Nothing was ever loaded: lead with reps, and leave out the tiles that
        // would all read "—" (weight, 1RM, volume).
        <div className="mt-2 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <Stat label={d.last} value={topLast ? `${topLast.reps} ${d.repsUnit}` : "—"} accent />
          <Stat label={d.maxReps} value={stats.best_reps === null ? "—" : String(stats.best_reps)} />
          <Stat label={d.sessions} value={stats.sessions.toLocaleString(locale)} />
          <Stat label={d.totalSets} value={stats.total_sets.toLocaleString(locale)} />
        </div>
      ) : (
        <div className="mt-2 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <Stat label={d.last} value={topLast ? setLabel(topLast, u, d.repsUnit) : "—"} accent />
          <Stat label={d.bestWeight} value={weight(stats.best_weight_kg, u, locale)}
            note={stats.best_reps_at_best_weight ? fill(d.repsAtBestWeight, { reps: stats.best_reps_at_best_weight }) : undefined} />
          <Stat label={d.bestReps} value={stats.best_reps === null ? "—" : String(stats.best_reps)} />
          <Stat label={d.estimated1rm} value={weight(round1(stats.best_1rm), u, locale)} />
          <Stat label={d.bestVolume} value={weight(stats.best_volume_kg, u, locale, true)} />
          <Stat label={d.sessions} value={stats.sessions.toLocaleString(locale)} />
          <Stat label={d.totalSets} value={stats.total_sets.toLocaleString(locale)} />
          <Stat label={d.totalVolume} value={weight(stats.total_volume_kg, u, locale, true)} />
        </div>
      )}
      {truncated ? <p className="mt-2 text-[11.5px] text-ink-faint">{d.truncated}</p> : null}
    </section>
  );
}

function Stat({ label, value, note, accent = false }: { label: string; value: string; note?: string; accent?: boolean }) {
  return (
    <div className={`rounded-2xl px-3.5 py-3 ${accent ? "bg-accent-soft" : "bg-surface"}`}>
      <p className={`text-[10px] font-semibold uppercase tracking-wider ${accent ? "text-accent-ink" : "text-ink-faint"}`}>
        {label}
      </p>
      <p className={`mt-1 font-display text-[17px] font-extrabold tabular-nums leading-tight ${accent ? "text-accent-ink" : "text-ink"}`}>
        {value}
      </p>
      {note ? <p className="mt-0.5 text-[10.5px] tabular-nums text-ink-faint">{note}</p> : null}
    </div>
  );
}

function RangeTabs({ value, onChange }: { value: ExerciseRangeDays; onChange: (v: ExerciseRangeDays) => void }) {
  const { t } = useI18n();
  const d = t.clientApp.exerciseDetail;
  return (
    <div className="flex flex-wrap gap-1" role="tablist">
      {EXERCISE_RANGES.map((days) => {
        const label = days === null ? d.rangeAll : days === 365 ? d.rangeYear : fill(d.rangeDays, { days });
        const on = days === value;
        return (
          <button
            key={String(days)}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(days)}
            className={`h-8 rounded-full px-3 text-[12px] font-semibold tabular-nums ${
              on ? "bg-accent text-accent-fg" : "bg-surface text-ink-soft hover:text-ink"
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * One metric over time. Three of these rather than one chart with three scales:
 * kilograms, kilograms-moved and an estimate do not share a y-axis, and forcing
 * them onto one is the fastest way to make a chart lie.
 *
 * Points sit at their real position in time, so a month off looks like a month
 * off rather than one step to the right.
 */
export function MetricChart({
  title, metric, sessions, range, todayIso, hint,
}: {
  title: string;
  metric: ExerciseMetric;
  sessions: ExerciseSessionEntry[];
  range: ExerciseRangeDays;
  todayIso: string;
  hint?: string;
}) {
  const { t } = useI18n();
  const u = useUnits();
  const d = t.clientApp.exerciseDetail;
  // Reps are a count; everything else is a load in the reader's unit.
  const reps = metric === "reps";
  const unit = reps ? d.repsUnit : u.weightUnit;
  const points = useMemo(
    () => metricSeries(sessions, metric, range, todayIso).map((p) => (reps ? p : { ...p, value: kgToDisplay(p.value, u.weightUnit) })),
    [sessions, metric, range, todayIso, u.weightUnit, reps],
  );
  return <PointsChart title={title} points={points} unit={unit} hint={hint} />;
}

/**
 * A titled card over already-converted points: nothing in the window, a single
 * figure, or the line. Shared by the exercise page and the progress dashboard
 * (body weight, circumferences), so "one point is not a trend" reads the same
 * everywhere.
 */
export function PointsChart({
  title, points, unit, hint,
}: {
  title: string;
  /** Oldest first, in the reader's unit. */
  points: MetricPoint[];
  unit: string;
  hint?: string;
}) {
  const { t, locale } = useI18n();
  const d = t.clientApp.exerciseDetail;

  const fmt = useMemo(
    () => new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", { day: "numeric", month: "short" }),
    [locale],
  );

  return (
    <Card plain>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{title}</p>
      {points.length === 0 ? (
        <p className="mt-3 text-[13px] text-ink-faint">{d.noneInRange}</p>
      ) : points.length === 1 ? (
        <>
          <p className="mt-2 font-display text-[26px] font-extrabold tabular-nums leading-none">
            {points[0].value.toLocaleString(locale)} <span className="text-base text-ink-faint">{unit}</span>
          </p>
          <p className="mt-1.5 text-[12px] text-ink-faint">{fmt.format(dayDate(points[0].day))} · {d.notEnoughForChart}</p>
        </>
      ) : (
        <LineChart points={points} unit={unit} fmt={fmt} locale={locale} />
      )}
      {hint ? <p className="mt-2 text-[10.5px] text-ink-faint">{hint}</p> : null}
    </Card>
  );
}

/** Plot geometry, in viewBox units. Kept small so the card stays a card. */
const W = 320;
const H = 116;
const PAD = { top: 14, right: 10, bottom: 18, left: 10 };

function LineChart({
  points, unit, fmt, locale,
}: {
  points: MetricPoint[];
  unit: string;
  fmt: Intl.DateTimeFormat;
  locale: string;
}) {
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  // A flat series still deserves a line through the middle rather than a
  // division by zero or a spike glued to the top edge.
  const span = max - min || Math.max(max * 0.1, 1);
  const lo = max === min ? min - span / 2 : min;

  const first = dayDate(points[0].day).getTime();
  const lastTime = dayDate(points[points.length - 1].day).getTime();
  const timeSpan = lastTime - first || 1;

  const coords = points.map((p) => ({
    ...p,
    x: PAD.left + ((dayDate(p.day).getTime() - first) / timeSpan) * (W - PAD.left - PAD.right),
    y: PAD.top + (1 - (p.value - lo) / span) * (H - PAD.top - PAD.bottom),
  }));
  const path = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
  const peak = coords.reduce((best, c) => (c.value > best.value ? c : best), coords[0]);
  const last = coords[coords.length - 1];
  const delta = last.value - coords[0].value;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 h-[116px] w-full" role="img"
        aria-label={`${points.length} · ${coords[0].value} → ${last.value} ${unit}`}>
        {/* Recessive baseline: the scale is implied by the labels, so the grid
            stays out of the way of the one thing worth reading. */}
        <line x1={PAD.left} y1={H - PAD.bottom} x2={W - PAD.right} y2={H - PAD.bottom}
          stroke="var(--color-line)" strokeWidth="1" />
        <path d={path} fill="none" stroke="var(--color-accent)" strokeWidth="2"
          strokeLinejoin="round" strokeLinecap="round" />
        {coords.map((c) => (
          <circle key={c.day + c.value} cx={c.x} cy={c.y} r={c === last || c === peak ? 4 : 3}
            fill="var(--color-accent)" stroke="var(--color-surface)" strokeWidth="2">
            {/* The hover layer, without shipping a charting library: every point
                names its own date and value. */}
            <title>{`${fmt.format(dayDate(c.day))} · ${c.value.toLocaleString(locale)} ${unit}`}</title>
          </circle>
        ))}
      </svg>
      {/* Direct labels for the two points worth naming — never one per point. */}
      <div className="flex items-baseline justify-between gap-2 text-[11px] tabular-nums text-ink-faint">
        <span>{fmt.format(dayDate(points[0].day))}</span>
        <span className={delta > 0 ? "font-bold text-accent-ink" : delta < 0 ? "font-bold text-ink-soft" : "font-semibold"}>
          {delta > 0 ? "+" : ""}{round1(delta)?.toLocaleString(locale)} {unit}
        </span>
        <span>{fmt.format(dayDate(last.day))}</span>
      </div>
    </div>
  );
}

/** Chronological list: date, day, every set, volume and the session's best estimate. */
function SessionHistory({ sessions }: { sessions: ExerciseSessionEntry[] }) {
  const { t, locale } = useI18n();
  const u = useUnits();
  const d = t.clientApp.exerciseDetail;
  const fmt = new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", {
    day: "numeric", month: "short", year: "numeric",
  });

  return (
    <ul className="mt-3 space-y-2.5">
      {sessions.map((s) => (
        <li key={s.session_id}>
          <Card plain>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <p className="text-[15px] font-semibold">{fmt.format(new Date(s.at))}</p>
              {s.name ? <p className="text-[12.5px] text-ink-faint">{s.name}</p> : null}
            </div>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {s.sets.map((set) => (
                <li
                  key={set.set_index}
                  className={`rounded-[10px] px-2.5 py-1.5 text-xs tabular-nums ${
                    set.is_pr ? "bg-accent font-semibold text-accent-fg" : "bg-bg text-ink-soft"
                  }`}
                >
                  {setLabel(set, u, d.repsUnit)}
                  {set.rir !== null ? ` · ${t.clientWidgets.setLogger.rir} ${set.rir}` : ""}
                  {set.rir === null && set.rpe !== null ? ` · ${set.rpe}/10` : ""}
                  {set.is_pr ? <span className="ml-1 text-[10px] font-bold uppercase">{d.pr}</span> : null}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[12px] tabular-nums text-ink-faint">
              {s.sets.length} {d.sets}
              {s.volume_kg > 0 ? <> · {d.volume} <b className="text-ink-soft">{weight(s.volume_kg, u, locale, true)}</b></> : null}
              {s.best_1rm !== null ? <> · {d.estimated1rm} <b className="text-ink-soft">{weight(round1(s.best_1rm), u, locale)}</b></> : null}
            </p>
          </Card>
        </li>
      ))}
    </ul>
  );
}

/**
 * Heaviest load for at least N reps. A run of rep counts sharing one weight
 * from one session reads as one row ("1–3 RM · 80 kg"), not three.
 */
function RepRecords({ records }: { records: RepRecord[] }) {
  const { t, locale } = useI18n();
  const u = useUnits();
  const d = t.clientApp.exerciseDetail;
  const fmt = new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", { day: "numeric", month: "short", year: "numeric" });
  const runs = records.reduce<{ from: number; to: number; weight_kg: number; at: string }[]>((acc, r) => {
    const last = acc.at(-1);
    if (last && last.weight_kg === r.weight_kg && last.at === r.at && last.to === r.reps - 1) last.to = r.reps;
    else acc.push({ from: r.reps, to: r.reps, weight_kg: r.weight_kg, at: r.at });
    return acc;
  }, []);
  return (
    <Card plain className="mt-3 overflow-hidden p-0">
      <div className="px-5 pb-1 pt-[18px]">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{d.repRecords}</p>
        <p className="mt-1.5 text-[12.5px] text-ink-faint">{d.repRecordsHint}</p>
      </div>
      <ul className="mt-2 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
        {runs.map((r) => (
          <li key={r.from} className="border-t border-line/60 px-5 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
              {r.from === r.to ? r.from : `${r.from}–${r.to}`} RM
            </p>
            <p className="mt-0.5 font-display text-[19px] font-extrabold tabular-nums leading-none">
              {weight(r.weight_kg, u, locale)}
            </p>
            <p className="mt-1 text-[11px] tabular-nums text-ink-faint">{fmt.format(new Date(r.at))}</p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ---------- formatting ----------

/** One set as a gym reads it: "80 kg × 5", or "15 reps" when nothing was loaded. */
function setLabel(set: { weight_kg: number; reps: number }, u: Units, repsUnit: string): string {
  return set.weight_kg > 0
    ? `${kgToDisplay(set.weight_kg, u.weightUnit)} ${u.weightUnit} × ${set.reps}`
    : `${set.reps} ${repsUnit}`;
}

type Units = ReturnType<typeof useUnits>;

/**
 * A stored kilogram for reading. Big totals lose the decimal and gain
 * separators — "12,480 kg" is a number you can hold in your head.
 */
function weight(kg: number | null, u: Units, locale: string, big = false): string {
  if (kg === null) return "—";
  const value = kgToDisplay(kg, u.weightUnit);
  const text = big || Math.abs(value) >= 1000
    ? Math.round(value).toLocaleString(locale)
    : value.toLocaleString(locale);
  return `${text} ${u.weightUnit}`;
}

function round1(n: number | null): number | null {
  return n === null ? null : Math.round(n * 10) / 10;
}

/** An ISO day as a local Date — never `new Date("2026-09-20")`, which is UTC midnight. */
function dayDate(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
}
