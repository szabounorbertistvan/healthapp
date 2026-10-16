"use client";
import Link from "next/link";
import {
  type PeriodChangeRow,
  type ProgressionAnalysis,
  type ProgressionMetric,
  type ProgressionReason,
  type ProgressionStatus,
  type SessionPerformance,
} from "@healthapp/shared";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { useUnits } from "@/lib/units/client";
import { PointsChart } from "./exercise-analytics";
import { Card } from "./ui";
import { usePlan } from "@/lib/plan-client";
import { PremiumSoon, UpgradeHint } from "./upgrade";

/**
 * The progression verdict for one exercise, and the evidence behind it. It
 * formats; the analysis arrives computed on the server
 * (packages/shared/exercise-progression over the person's own completed sets),
 * in kilograms — only the reader's unit is applied here.
 *
 * Wording is deliberately cautious: "possible plateau", never a diagnosis, and
 * the suggestion says what to look at rather than what to change.
 */

const TONE: Record<ProgressionStatus, string> = {
  progress: "bg-accent-soft text-accent-ink",
  stable: "bg-bg text-ink-soft",
  plateau: "bg-warn-soft text-warn",
  regression: "bg-risk-soft text-risk",
  insufficient: "bg-bg text-ink-faint",
};

function useProgressionFormat() {
  const { t, locale } = useI18n();
  const u = useUnits();
  const p = t.clientApp.progression;
  const tag = locale === "ro" ? "ro-RO" : "en-GB";
  const n0 = new Intl.NumberFormat(tag, { maximumFractionDigits: 0 });
  const n1 = new Intl.NumberFormat(tag, { maximumFractionDigits: 1 });
  const df = new Intl.DateTimeFormat(tag, { day: "numeric", month: "short", year: "numeric" });
  const date = (day: string) => {
    const [y = 1970, m = 1, d = 1] = day.split("-").map(Number);
    return df.format(new Date(y, m - 1, d));
  };
  /** A performance value in its metric's unit, in the reader's units. */
  const value = (metric: ProgressionMetric, v: number) =>
    metric === "reps" ? `${n0.format(v)} ${t.clientApp.exerciseDetail.repsUnit}` : u.weight(v, { big: metric === "best_set" });
  const set = (x: { weight_kg: number; reps: number }) =>
    x.weight_kg > 0 ? `${u.weight(x.weight_kg)} × ${x.reps}` : `${x.reps} ${t.clientApp.exerciseDetail.repsUnit}`;
  const signedPct = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${n1.format(Math.abs(v))}%`;
  return { t, p, u, n0, n1, date, value, set, signedPct };
}

function reasonText(r: ProgressionReason, f: ReturnType<typeof useProgressionFormat>): string {
  const { p, n0, n1 } = f;
  switch (r.code) {
    case "new_best": {
      const ago = r.sessions_ago === 0 ? p.reason.newBestToday
        : r.sessions_ago === 1 ? p.reason.newBestAgoOne
        : fill(p.reason.newBestAgo, { count: r.sessions_ago });
      return fill(p.reason.new_best, { ago, change: n1.format(r.change_pct) });
    }
    case "within_band": return fill(p.reason.within_band, { band: n1.format(r.band_pct), count: r.sessions });
    case "no_new_best": return fill(p.reason.no_new_best, { count: r.sessions, days: r.days });
    case "repeated_drop": return fill(p.reason.repeated_drop, { drops: r.drops, of: r.of, drop: n0.format(r.drop_pct) });
    case "isolated_dip": return fill(p.reason.isolated_dip, { drops: r.drops, of: r.of });
    default: return fill(p.reason[r.code], { have: r.have, need: r.need });
  }
}

/** The status chip alone — the overview rows and the card share it. */
export function ProgressionBadge({ status }: { status: ProgressionStatus }) {
  const { t } = useI18n();
  return (
    <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${TONE[status]}`}>
      {t.clientApp.progression.status[status]}
    </span>
  );
}

/** The exercise page's card: verdict, reasons, comparison, periods, the points, the suggestion, how it is worked out. */
export function ProgressionCard({ analysis, chartsLocked = false }: { analysis: ProgressionAnalysis; chartsLocked?: boolean }) {
  const f = useProgressionFormat();
  const { p, t, u } = f;
  const { e: plan, upgrade } = usePlan();
  // Premium (ENTITLEMENTS.progressionInsights): the verdict and its reasons.
  // The history, bests and charts around it follow their own gates.
  if (!plan.progressionInsights) {
    return (
      <section className="mt-6" aria-labelledby="progression-title">
        <h2 id="progression-title" className="font-display text-lg font-bold tracking-tight">{p.title}</h2>
        <UpgradeHint card feature="plateau" upgrade={upgrade} className="mt-3" />
      </section>
    );
  }
  const a = analysis;
  const insufficient = a.status === "insufficient";
  const chartPoints = a.series.map((x) => ({ day: x.day, value: a.metric === "reps" ? x.value : u.weightValue(x.value) }));
  const unit = a.metric === "reps" ? t.clientApp.exerciseDetail.repsUnit : u.weightUnit;

  return (
    <section className="mt-6" aria-labelledby="progression-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="progression-title" className="flex flex-wrap items-center gap-2 font-display text-lg font-bold tracking-tight">
          {p.title}
          <PremiumSoon feature="progressionInsights" />
        </h2>
        <ProgressionBadge status={a.status} />
      </div>

      <Card plain className="mt-3 space-y-3 sm:p-5">
        {insufficient ? <p className="font-display text-[15px] font-bold">{p.insufficientTitle}</p> : null}
        <ul className="space-y-1 text-[13.5px] leading-relaxed text-ink">
          {a.reasons.map((r, i) => <li key={i}>{reasonText(r, f)}</li>)}
        </ul>
        <p className="text-[12px] text-ink-faint">
          {a.sessions_analyzed > 0 && a.from_day && a.to_day
            ? fill(p.analyzed, { count: a.sessions_analyzed, from: f.date(a.from_day), to: f.date(a.to_day) })
            : p.analyzedNone}
          {a.sessions_analyzed > 0 ? ` · ${p.metric[a.metric]}` : ""}
        </p>

        {a.latest && a.best ? (
          <div className="grid grid-cols-2 gap-2.5">
            <Figure label={p.latest} perf={a.latest} metric={a.metric} f={f} />
            <Figure label={p.best} perf={a.best} metric={a.metric} f={f} />
          </div>
        ) : null}

        {a.comparison ? (
          <div className="rounded-2xl bg-bg px-3.5 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
              {p.vsPrevious} · {f.date(a.comparison.from.day)} → {f.date(a.comparison.to.day)}
            </p>
            <dl className="mt-1.5 grid gap-1 text-[12.5px] sm:grid-cols-3">
              <div>
                <dt className="text-ink-faint">{p.topSet}</dt>
                <dd className="font-semibold">
                  {a.comparison.top_set
                    ? fill(p.kind[a.comparison.top_set.kind], {
                        value: a.comparison.top_set.kind.startsWith("weight")
                          ? u.weight(Math.abs(a.comparison.top_set.weight_delta_kg))
                          : Math.abs(a.comparison.top_set.reps_delta),
                      })
                    : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-ink-faint">{p.volume}</dt>
                <dd className="font-semibold tabular-nums">
                  {a.comparison.volume_delta_kg === 0 ? "±0" : `${a.comparison.volume_delta_kg > 0 ? "+" : "−"}${u.weight(Math.abs(a.comparison.volume_delta_kg), { big: true })}`}
                </dd>
              </div>
              <div>
                <dt className="text-ink-faint">{p.workingSets}</dt>
                <dd className="font-semibold tabular-nums">
                  {a.comparison.from.working_sets} → {a.comparison.to.working_sets}
                </dd>
              </div>
            </dl>
          </div>
        ) : null}

        <Periods rows={a.periods} f={f} />

        {!chartsLocked && chartPoints.length > 0 ? (
          <div className="rounded-2xl bg-bg">
            <PointsChart title={p.chartTitle} points={chartPoints} unit={unit} />
          </div>
        ) : null}

        <div className="rounded-2xl bg-accent-soft/40 px-3.5 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">{p.suggestionTitle}</p>
          <p className="mt-1 text-[13px] leading-relaxed text-ink">{p.suggestion[a.suggestion]}</p>
        </div>

        <details>
          <summary className="cursor-pointer text-[12.5px] font-semibold text-ink-faint hover:text-ink">{p.howTitle}</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[12.5px] leading-relaxed text-ink-soft">
            <li>{p.how.data}</li>
            <li>{p.metric[a.metric]}</li>
            <li>{p.how.volume}</li>
            <li>{fill(p.how.warmups, { count: a.warmups_excluded })}</li>
            <li>
              {fill(p.how.rules, {
                minSessions: a.rules.minSessions,
                minSpanDays: a.rules.minSpanDays,
                noise: a.rules.noisePct,
                plateauSessions: a.rules.plateauSessions,
                plateauDays: a.rules.plateauDays,
                regressionSessions: a.rules.regressionSessions,
                recent: a.rules.recentWindow,
                regression: a.rules.regressionPct,
              })}
            </li>
            <li>{p.how.caution}</li>
          </ul>
        </details>
      </Card>
    </section>
  );
}

function Figure({ label, perf, metric, f }: {
  label: string;
  perf: SessionPerformance;
  metric: ProgressionMetric;
  f: ReturnType<typeof useProgressionFormat>;
}) {
  const v = metric === "one_rm" ? perf.best_1rm : metric === "reps" ? perf.top_reps : perf.best_set ? perf.best_set.weight_kg * perf.best_set.reps : null;
  return (
    <div className="rounded-2xl bg-bg px-3.5 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">{label}</p>
      <p className="mt-1 font-display text-[17px] font-extrabold tabular-nums leading-tight">
        {perf.best_set ? f.set(perf.best_set) : "—"}
      </p>
      <p className="mt-0.5 text-[11px] tabular-nums text-ink-faint">
        {v !== null ? f.value(metric, Math.round(v * 10) / 10) : "—"} · {f.date(perf.day)}
      </p>
    </div>
  );
}

function Periods({ rows, f }: { rows: PeriodChangeRow[]; f: ReturnType<typeof useProgressionFormat> }) {
  const { p } = f;
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">{p.periods}</p>
      <ul className="mt-1.5 grid grid-cols-5 gap-1.5 text-center">
        {rows.map((r) => {
          const label = r.days === null ? p.periodAll : r.days === 365 ? p.periodYear : fill(p.periodDays, { days: r.days });
          return (
            <li key={String(r.days)} className="rounded-xl bg-bg px-1 py-2">
              <p className="text-[10.5px] font-semibold text-ink-faint">{label}</p>
              <p className={`mt-0.5 text-[13px] font-bold tabular-nums ${
                r.change_pct === null ? "text-ink-faint" : r.change_pct > 0 ? "text-accent-ink" : "text-ink"
              }`}>
                {r.change_pct === null ? p.periodNone : f.signedPct(r.change_pct)}
              </p>
              <p className="sr-only">{fill(p.periodSessions, { count: r.sessions })}</p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * The strength tab's list: one row per lift, the chip and the first reason,
 * linked to the exercise page. `forCoach` is the coach's client page: the
 * client's main lifts, unlinked — /exercises/[id] shows the reader's own
 * history, not the client's.
 */
export function ProgressionOverview({ items, forCoach = false }: {
  items: { id: string; name: string; analysis: ProgressionAnalysis }[];
  forCoach?: boolean;
}) {
  const f = useProgressionFormat();
  const { p } = f;
  return (
    <Card plain className="overflow-hidden p-0">
      <div className="px-5 pb-1 pt-[18px]">
        <p className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
          {forCoach ? p.coachOverviewTitle : p.overviewTitle}
          {forCoach ? null : <PremiumSoon feature="progressionInsights" />}
        </p>
        <p className="mt-1 text-[12px] text-ink-faint">{forCoach ? p.coachOverviewHint : p.overviewHint}</p>
      </div>
      {items.length === 0 ? (
        <p className="px-5 pb-[18px] pt-2 text-[13px] text-ink-faint">{forCoach ? p.coachOverviewEmpty : p.overviewEmpty}</p>
      ) : (
        <ul className="mt-1 divide-y divide-line/60">
          {items.map(({ id, name, analysis }) => (
            <li key={id} className="px-5 py-3.5">
              <div className="flex items-start justify-between gap-3">
                {forCoach ? (
                  <span className="min-w-0 truncate text-[14px] font-semibold">{name}</span>
                ) : (
                  <Link href={`/exercises/${id}`} className="min-w-0 truncate text-[14px] font-semibold hover:text-accent-ink">
                    {name}
                  </Link>
                )}
                <ProgressionBadge status={analysis.status} />
              </div>
              {analysis.reasons[0] ? (
                <p className="mt-1 text-[12.5px] leading-snug text-ink-soft">{reasonText(analysis.reasons[0], f)}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
