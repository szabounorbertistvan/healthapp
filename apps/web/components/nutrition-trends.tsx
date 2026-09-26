"use client";
import Link from "next/link";
import {
  macroAdherence,
  macroDistribution,
  periodChange,
  splitFromGrams,
  type MacroLine,
  type Macros,
  type NutritionBucket,
  type NutritionInsight,
  type NutritionPeriod,
  type NutritionProgress,
} from "@healthapp/shared";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { foodHref, NUTRITION_CHARTS, type FoodState, type NutritionChart } from "@/lib/nutrition-params";
import { ComparisonNote, Eyebrow, Figure, RangeLinks } from "./advanced-progress";
import { Card } from "./ui";

/**
 * /food?view=trends — the client half. It formats; every number arrives
 * already folded on the server (packages/shared/nutrition-progress over
 * food_daily_totals), exact, and is rounded only here.
 *
 * On a phone it is one column and one chart at a time (the chart tabs are
 * links); from tablet width the cards sit two across.
 */

function useFormat() {
  const { t, locale } = useI18n();
  const tag = locale === "ro" ? "ro-RO" : "en-GB";
  const n0 = new Intl.NumberFormat(tag, { maximumFractionDigits: 0 });
  const n1 = new Intl.NumberFormat(tag, { maximumFractionDigits: 1 });
  const df = new Intl.DateTimeFormat(tag, { day: "numeric", month: "short" });
  return {
    t,
    n: t.clientApp.nutritionTrends,
    m: t.common.macros,
    kcal: (v: number) => `${n0.format(v)} kcal`,
    g: (v: number) => `${n1.format(v)} g`,
    pct: (v: number) => n1.format(v),
    count: (v: number) => n0.format(v),
    date: (day: string) => {
      const [y = 1970, mo = 1, d = 1] = day.split("-").map(Number);
      return df.format(new Date(y, mo - 1, d));
    },
  };
}

const KEYS = ["kcal", "protein", "carbs", "fat"] as const;

// ---------- view switch ----------

/** Diary | Trends, above the week strip. Plain links: each view is its own server render. */
export function FoodViewTabs({ view }: { view: FoodState["view"] }) {
  const { n } = useFormat();
  const tabs: { key: FoodState["view"]; label: string; href: string }[] = [
    { key: "diary", label: n.diary, href: "/food" },
    { key: "trends", label: n.trends, href: foodHref({ view: "trends", range: 30, chart: "kcal" }) },
  ];
  return (
    <nav className="grid grid-cols-2 gap-1 rounded-2xl bg-surface p-1 sm:max-w-xs" aria-label={n.viewLabel}>
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          scroll={false}
          aria-current={tab.key === view ? "page" : undefined}
          className={`rounded-xl py-2 text-center text-[13px] font-semibold ${
            tab.key === view ? "bg-bg text-ink shadow-sm" : "text-ink-soft hover:text-ink"
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

// ---------- the page body ----------

export function NutritionTrends({
  state,
  today,
  progress,
  insights,
  series,
  week,
  plan,
  truncated,
}: {
  state: FoodState;
  today: { totals: Macros; target: Macros | null; meals: number };
  progress: NutritionProgress;
  insights: NutritionInsight[];
  series: { unit: "day" | "week" | "month"; items: NutritionBucket[] };
  week: { current: NutritionPeriod; previous: NutritionPeriod };
  plan: { name: string; owner: "coach" | "self"; plannedKcal: number | null; plannedMeals: number } | null;
  truncated: boolean;
}) {
  const f = useFormat();
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <RangeLinks value={state.range} hrefFor={(range) => foodHref({ ...state, range })} />
        <ComparisonNote range={state.range} hasPrevious={progress.previous !== null} />
        {truncated ? <p className="text-[12px] text-ink-faint">{f.n.truncated}</p> : null}
      </div>

      <div className="grid gap-4 @3xl:grid-cols-2 @3xl:items-start">
        <div className="space-y-4">
          <TodayCard totals={today.totals} target={today.target} meals={today.meals} />
          <InsightList insights={insights} />
          <PeriodCard progress={progress} hasTarget={today.target !== null} />
        </div>
        <div className="space-y-4">
          <ChartsCard state={state} series={series} target={today.target} avg={progress.current.avg} />
          <WeekCard week={week} hasTarget={today.target !== null} />
          {plan ? <PlanCard plan={plan} target={today.target} /> : null}
          <Card plain>
            <Eyebrow>{f.n.micronutrients}</Eyebrow>
            <p className="mt-2 text-[13px] text-ink-faint">{f.n.micronutrientsUnavailable}</p>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ---------- today ----------

function TodayCard({ totals, target, meals }: { totals: Macros; target: Macros | null; meals: number }) {
  const f = useFormat();
  if (target === null) {
    return (
      <Card plain>
        <Eyebrow aside={fill(f.n.mealsLogged, { count: meals })}>{f.n.today}</Eyebrow>
        <p className="mt-3 font-display text-lg font-bold">{f.n.noTarget}</p>
        <p className="mt-1 text-[13px] text-ink-soft">{f.n.noTargetHint}</p>
        <p className="mt-2 text-[13px] tabular-nums text-ink-faint">
          {f.kcal(totals.kcal)} · {f.m.protein} {f.g(totals.protein)} · {f.m.carbs} {f.g(totals.carbs)} · {f.m.fat} {f.g(totals.fat)}
        </p>
        <Link href="/food" className="mt-3 inline-block text-[12.5px] font-semibold text-accent-ink hover:underline">
          {f.n.setTargets} →
        </Link>
      </Card>
    );
  }
  const a = macroAdherence(totals, target);
  const lines: { label: string; line: MacroLine; fmt: (v: number) => string }[] = [
    { label: f.m.calories, line: a.kcal, fmt: f.kcal },
    { label: f.m.protein, line: a.protein, fmt: f.g },
    { label: f.m.carbs, line: a.carbs, fmt: f.g },
    { label: f.m.fat, line: a.fat, fmt: f.g },
  ];
  return (
    <Card plain>
      <Eyebrow aside={fill(f.n.mealsLogged, { count: meals })}>{f.n.today}</Eyebrow>
      <ul className="mt-3 space-y-3">
        {lines.map((l) => (
          <li key={l.label}>
            <AdherenceRow label={l.label} line={l.line} fmt={l.fmt} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** consumed / target, the bar (clamped so no value can break it), the percentage and the difference. */
function AdherenceRow({ label, line, fmt }: { label: string; line: MacroLine; fmt: (v: number) => string }) {
  const f = useFormat();
  const pct = line.pct;
  const width = pct === null ? 0 : Math.min(Math.max(pct, 0), 100);
  const over = pct !== null && pct > 100;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] font-semibold">{label}</span>
        <span className="text-[13px] tabular-nums">
          <b>{fmt(line.consumed)}</b>
          {line.target !== null ? <span className="text-ink-faint"> / {fmt(line.target)}</span> : null}
        </span>
      </div>
      {line.target !== null ? (
        <>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-bg">
            <div className={`h-full rounded-full ${over ? "bg-warn" : "bg-accent"}`} style={{ width: `${width}%` }} />
          </div>
          <div className="mt-1 flex justify-between text-[11px] tabular-nums text-ink-faint">
            <span>{fill(f.n.ofTarget, { pct: f.pct(pct ?? 0) })}</span>
            <span>
              {f.n.difference} {line.difference! > 0 ? "+" : line.difference! < 0 ? "−" : ""}
              {fmt(Math.abs(line.difference!))}
            </span>
          </div>
        </>
      ) : null}
    </div>
  );
}

// ---------- insights ----------

function InsightList({ insights }: { insights: NutritionInsight[] }) {
  const f = useFormat();
  const n = f.n;
  const sentence = (i: NutritionInsight): string => {
    switch (i.key) {
      case "insufficient_data":
        return fill(n.insightInsufficient, { min: i.min, days: i.days_logged });
      case "avg_kcal":
        return fill(n.insightAvgKcal, { value: f.count(i.value) });
      case "kcal_vs_target":
        return Math.abs(i.pct) < 0.05
          ? n.insightKcalOn
          : fill(i.pct < 0 ? n.insightKcalBelow : n.insightKcalAbove, { pct: f.pct(Math.abs(i.pct)) });
      case "avg_protein":
        return fill(n.insightAvgProtein, { value: f.pct(i.value) });
      case "protein_reached":
        return fill(n.insightProteinReached, { days: i.days, logged: i.logged });
      case "logging":
        return fill(n.insightLogging, { days: i.days, total: i.window_days });
      case "kcal_change":
        return fill(i.pct > 0 ? n.insightKcalUp : n.insightKcalDown, { pct: f.pct(Math.abs(i.pct)) });
      case "protein_change":
        return fill(i.pct > 0 ? n.insightProteinUp : n.insightProteinDown, { pct: f.pct(Math.abs(i.pct)) });
    }
  };
  return (
    <Card plain>
      <Eyebrow>{n.insights}</Eyebrow>
      <ul className="mt-2.5 space-y-2">
        {insights.map((i) => (
          <li key={i.key} className="flex gap-2.5 text-[13.5px] leading-snug">
            <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
            <span>{sentence(i)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ---------- the period ----------

function PeriodCard({ progress, hasTarget }: { progress: NutritionProgress; hasTarget: boolean }) {
  const f = useFormat();
  const n = f.n;
  const cur = progress.current;
  const c = progress.changes;
  const avg = cur.avg;
  return (
    <Card plain>
      <Eyebrow aside={fill(n.daysLoggedValue, { days: cur.days_logged, total: cur.window_days })}>{n.period}</Eyebrow>
      {avg === null ? (
        <p className="mt-2.5 text-[13px] text-ink-faint">{n.noData}</p>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2.5">
            <Figure label={n.avgCalories} value={f.kcal(avg.kcal)} change={c?.kcal} format={f.kcal} />
            <Figure label={n.avgProtein} value={f.g(avg.protein)} change={c?.protein} format={f.g} />
            <Figure label={n.avgCarbs} value={f.g(avg.carbs)} change={c?.carbs} format={f.g} />
            <Figure label={n.avgFat} value={f.g(avg.fat)} change={c?.fat} format={f.g} />
          </div>
          <p className="mt-2 text-[11px] text-ink-faint">{n.avgNote}</p>
          {hasTarget && cur.adherence && cur.days_reached && cur.days_within ? (
            <div className="mt-3 space-y-3 border-t border-line/60 pt-3">
              {cur.kcal_score !== null ? (
                <Figure label={n.calorieAdherence} value={`${f.pct(cur.kcal_score)}%`} hint={n.calorieAdherenceHint} />
              ) : null}
              {KEYS.map((k) =>
                cur.adherence![k].target === null ? null : (
                  <div key={k}>
                    <AdherenceRow label={labelOf(f, k)} line={cur.adherence![k]} fmt={k === "kcal" ? f.kcal : f.g} />
                    <p className="mt-0.5 text-[11px] tabular-nums text-ink-faint">
                      {fill(n.reachedDays, { days: cur.days_reached![k], logged: cur.days_logged })} ·{" "}
                      {fill(n.withinDays, { days: cur.days_within![k], logged: cur.days_logged })}
                    </p>
                  </div>
                ),
              )}
              <p className="text-[11px] text-ink-faint">{n.targetNote}</p>
            </div>
          ) : null}
        </>
      )}
    </Card>
  );
}

function labelOf(f: ReturnType<typeof useFormat>, k: (typeof KEYS)[number]): string {
  return k === "kcal" ? f.m.calories : f.m[k];
}

// ---------- charts ----------

function ChartsCard({
  state,
  series,
  target,
  avg,
}: {
  state: FoodState;
  series: { unit: "day" | "week" | "month"; items: NutritionBucket[] };
  target: Macros | null;
  avg: Macros | null;
}) {
  const f = useFormat();
  const n = f.n;
  const label: Record<NutritionChart, string> = { kcal: n.chartKcal, protein: n.chartProtein, macros: n.chartMacros };
  const unitLabel = series.unit === "day" ? n.perDay : series.unit === "week" ? n.perWeek : n.perMonth;
  return (
    <Card plain>
      <Eyebrow>{n.charts}</Eyebrow>
      <nav className="mt-3 grid grid-cols-3 gap-1 rounded-xl bg-bg p-1" aria-label={n.charts}>
        {NUTRITION_CHARTS.map((c) => (
          <Link
            key={c}
            href={foodHref({ ...state, chart: c })}
            scroll={false}
            aria-current={c === state.chart ? "page" : undefined}
            className={`rounded-lg py-1.5 text-center text-[12px] font-semibold ${
              c === state.chart ? "bg-surface text-ink shadow-sm" : "text-ink-soft hover:text-ink"
            }`}
          >
            {label[c]}
          </Link>
        ))}
      </nav>
      <div className="mt-4">
        {state.chart === "macros" ? (
          <MacroSplitBars avg={avg} target={target} />
        ) : (
          <TargetBars
            items={series.items}
            value={(b) => (state.chart === "kcal" ? b.kcal : b.protein)}
            target={state.chart === "kcal" ? target?.kcal ?? null : target?.protein ?? null}
            format={state.chart === "kcal" ? f.kcal : f.g}
            caption={unitLabel}
          />
        )}
      </div>
    </Card>
  );
}

/**
 * Bars per day / week / month with the target as a dashed line. A bucket with
 * nothing logged keeps a hairline — a gap, never a zero-height "ate nothing".
 */
function TargetBars({
  items,
  value,
  target,
  format,
  caption,
}: {
  items: NutritionBucket[];
  value: (b: NutritionBucket) => number | null;
  target: number | null;
  format: (v: number) => string;
  caption: string;
}) {
  const f = useFormat();
  const values = items.map(value);
  const peak = Math.max(0, ...values.map((v) => v ?? 0));
  if (peak === 0) return <p className="text-[13px] text-ink-faint">{f.n.noData}</p>;
  const t = target !== null && Number.isFinite(target) && target > 0 ? target : null;
  const scale = Math.max(peak, t ?? 0) * 1.05;
  const first = items[0]!;
  const last = items[items.length - 1]!;
  return (
    <div>
      <div className="relative h-32">
        <div className="flex h-full items-end gap-[2px]">
          {items.map((b, i) => {
            const v = values[i];
            return (
              <div
                key={b.start}
                className="flex h-full flex-1 items-end"
                title={`${f.date(b.start)} · ${v === null ? f.n.notLogged : format(v)}`}
              >
                <div
                  className={`w-full rounded-t-[3px] ${v === null ? "bg-line" : t !== null && v > t * 1.1 ? "bg-warn" : "bg-accent"}`}
                  style={{ height: v === null ? "2px" : `${Math.max((v / scale) * 100, 2)}%` }}
                />
              </div>
            );
          })}
        </div>
        {t !== null ? (
          <div
            className="pointer-events-none absolute inset-x-0 border-t border-dashed border-ink-soft"
            style={{ bottom: `${(t / scale) * 100}%` }}
            aria-hidden
          />
        ) : null}
      </div>
      <div className="mt-2 flex items-baseline justify-between gap-2 text-[11px] tabular-nums text-ink-faint">
        <span>{f.date(first.start)}</span>
        <span>
          {caption}
          {t !== null ? ` · ${fill(f.n.targetLine, { value: format(t) })}` : ""}
        </span>
        <span>{f.date(last.start)}</span>
      </div>
    </div>
  );
}

/** Share of calories from each macro: the period's averages against the target split. */
function MacroSplitBars({ avg, target }: { avg: Macros | null; target: Macros | null }) {
  const f = useFormat();
  const actual = avg ? macroDistribution(avg) : null;
  const planned =
    target && target.protein + target.carbs + target.fat > 0 ? splitFromGrams(target) : null;
  if (!actual) return <p className="text-[13px] text-ink-faint">{f.n.noData}</p>;
  const rows = [
    { label: f.n.splitActual, split: actual },
    ...(planned ? [{ label: f.n.splitTarget, split: planned }] : []),
  ];
  const tone = { protein: "bg-accent", carbs: "bg-ink-soft", fat: "bg-warn" } as const;
  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <div key={r.label}>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{r.label}</p>
          <div className="mt-1.5 flex h-3 overflow-hidden rounded-full bg-bg">
            {(["protein", "carbs", "fat"] as const).map((k) => (
              <div key={k} className={tone[k]} style={{ width: `${r.split[k]}%` }} title={`${f.m[k]} ${r.split[k]}%`} />
            ))}
          </div>
          <p className="mt-1 text-[11.5px] tabular-nums text-ink-soft">
            {f.m.protein} {r.split.protein}% · {f.m.carbs} {r.split.carbs}% · {f.m.fat} {r.split.fat}%
          </p>
        </div>
      ))}
      <p className="text-[11px] text-ink-faint">{f.n.splitHint}</p>
    </div>
  );
}

// ---------- week ----------

function WeekCard({ week, hasTarget }: { week: { current: NutritionPeriod; previous: NutritionPeriod }; hasTarget: boolean }) {
  const f = useFormat();
  const n = f.n;
  const { current: cur, previous: prev } = week;
  const change = periodChange;
  return (
    <Card plain>
      <Eyebrow aside={fill(n.daysLoggedValue, { days: cur.days_logged, total: cur.window_days })}>{n.week}</Eyebrow>
      <p className="mt-1 text-[11.5px] text-ink-faint">{n.weekHint}</p>
      {cur.avg === null ? (
        <p className="mt-2.5 text-[13px] text-ink-faint">{n.noData}</p>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2.5">
            <Figure label={n.avgCalories} value={f.kcal(cur.avg.kcal)} change={change(cur.avg.kcal, prev.avg?.kcal)} format={f.kcal} />
            <Figure label={n.avgProtein} value={f.g(cur.avg.protein)} change={change(cur.avg.protein, prev.avg?.protein)} format={f.g} />
            <Figure label={n.avgCarbs} value={f.g(cur.avg.carbs)} change={change(cur.avg.carbs, prev.avg?.carbs)} format={f.g} />
            <Figure label={n.avgFat} value={f.g(cur.avg.fat)} change={change(cur.avg.fat, prev.avg?.fat)} format={f.g} />
          </div>
          <ul className="mt-3 space-y-1 text-[12.5px] tabular-nums text-ink-soft">
            {cur.highest && cur.lowest ? (
              <>
                <li>{n.highest}: <b>{f.date(cur.highest.day)}</b> · {f.kcal(cur.highest.kcal)}</li>
                <li>{n.lowest}: <b>{f.date(cur.lowest.day)}</b> · {f.kcal(cur.lowest.kcal)}</li>
              </>
            ) : null}
            {hasTarget && cur.days_reached && cur.adherence?.protein.target != null ? (
              <li>{f.m.protein}: {fill(n.reachedDays, { days: cur.days_reached.protein, logged: cur.days_logged })}</li>
            ) : null}
            {hasTarget && cur.kcal_score !== null ? (
              <li>{n.calorieAdherence}: <b>{f.pct(cur.kcal_score)}%</b></li>
            ) : null}
          </ul>
        </>
      )}
    </Card>
  );
}

// ---------- plan ----------

function PlanCard({
  plan,
  target,
}: {
  plan: { name: string; owner: "coach" | "self"; plannedKcal: number | null; plannedMeals: number };
  target: Macros | null;
}) {
  const f = useFormat();
  const n = f.n;
  return (
    <Card plain>
      <Eyebrow aside={plan.owner === "coach" ? n.planBy : n.planByYou}>{n.plan}</Eyebrow>
      <p className="mt-2 font-display text-lg font-bold">{plan.name}</p>
      {target ? (
        <p className="mt-1 text-[12.5px] tabular-nums text-ink-soft">
          {f.kcal(target.kcal)} · {f.m.protein} {f.g(target.protein)} · {f.m.carbs} {f.g(target.carbs)} · {f.m.fat} {f.g(target.fat)}
        </p>
      ) : null}
      <p className="mt-2.5 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{n.plannedToday}</p>
      <p className="mt-1 text-[13px] tabular-nums">
        {plan.plannedMeals > 0 && plan.plannedKcal !== null
          ? fill(n.plannedKcal, { kcal: f.count(plan.plannedKcal), meals: plan.plannedMeals })
          : n.noPlannedMeals}
      </p>
      <Link href="/food" className="mt-3 inline-block text-[12.5px] font-semibold text-accent-ink hover:underline">
        {n.openDiary} →
      </Link>
    </Card>
  );
}
