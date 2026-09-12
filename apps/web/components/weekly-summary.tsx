"use client";
import Link from "next/link";
import type { Delta, Insight } from "@healthapp/shared";
import type { WeeklySummary } from "@/lib/weekly-data";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { parseDay } from "@/lib/week";
import { Card } from "./ui";

/** Locale-aware number, date and duration formatting for the card. */
function useWeeklyFormat() {
  const { t, locale } = useI18n();
  const tag = locale === "ro" ? "ro-RO" : "en-GB";
  const nf = new Intl.NumberFormat(tag);
  const nf1 = new Intl.NumberFormat(tag, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const nfp = new Intl.NumberFormat(tag, { maximumFractionDigits: 1 });
  const df = new Intl.DateTimeFormat(tag, { day: "numeric", month: "short" });
  const w = t.common.weekly;
  return {
    n: (v: number) => nf.format(v),
    n1: (v: number) => nf1.format(v),
    signed: (v: number, digits: 0 | 1 = 1) => `${v > 0 ? "+" : ""}${(digits === 1 ? nf1 : nf).format(v)}`,
    date: (day: string) => df.format(parseDay(day)),
    duration: (min: number) =>
      min >= 60 ? fill(w.hours, { h: Math.floor(min / 60), m: min % 60 }) : fill(w.minutes, { m: min }),
    pct: (v: number) => `${v > 0 ? "+" : ""}${nfp.format(v)}%`,
  };
}

/** "vs 287 last week · +10.8%" under a headline number. */
function DeltaLine({ d, format }: { d: Delta | null; format: (v: number) => string }) {
  const { t } = useI18n();
  const f = useWeeklyFormat();
  const w = t.common.weekly;
  if (!d) return null;
  const tone = d.direction === "up" ? "text-accent-ink" : d.direction === "down" ? "text-warn" : "text-ink-faint";
  return (
    <p className="mt-0.5 text-[11px] leading-snug text-ink-faint">
      <span>{d.previous === 0 && d.pct === null ? w.noPreviousWeek : fill(w.vsLastWeek, { value: format(d.previous) })}</span>
      {d.pct !== null ? <span className={`ml-1 whitespace-nowrap font-semibold tabular-nums ${tone}`}>{f.pct(d.pct)}</span> : null}
    </p>
  );
}

function Stat({ label, value, unit, delta, format }: {
  label: string; value: string; unit?: string; delta?: Delta | null; format?: (v: number) => string;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{label}</p>
      <p className="mt-0.5 truncate text-xl font-bold tabular-nums leading-tight">
        {value}
        {unit ? <span className="ml-1 text-xs font-medium text-ink-faint">{unit}</span> : null}
      </p>
      {delta !== undefined && format ? <DeltaLine d={delta} format={format} /> : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-line pt-3">
      <h3 className="mb-2 text-xs font-bold">{title}</h3>
      {children}
    </section>
  );
}

function insightText(i: Insight, t: ReturnType<typeof useI18n>["t"], f: ReturnType<typeof useWeeklyFormat>): string {
  const m = t.common.weekly.insight;
  switch (i.key) {
    case "load_up": return fill(m.load_up, { pct: f.n1(i.pct) });
    case "load_down": return fill(m.load_down, { pct: f.n1(i.pct) });
    case "more_workouts": return fill(m.more_workouts, { count: i.count });
    case "fewer_workouts": return fill(m.fewer_workouts, { count: i.count });
    case "prs": return fill(m.prs, { count: i.count });
    case "volume_up": return fill(m.volume_up, { pct: f.n1(i.pct) });
    case "volume_down": return fill(m.volume_down, { pct: f.n1(i.pct) });
    case "all_planned_done": return m.all_planned_done;
    case "nutrition_adherence": return fill(m.nutrition_adherence, { pct: i.pct });
    case "weight_change": return fill(m.weight_change, { delta: f.signed(i.delta) });
    case "no_data": return m.no_data;
  }
}

/**
 * The week in one card: training, nutrition, progress, consistency, PRs and
 * the insight line. Everything comes from @healthapp/shared's comparison; the
 * card only formats. `switchPath` renders the current / previous toggle when
 * the page supports it — a path string, since a function cannot cross the
 * server → client boundary; the card appends ?week=.
 */
export function WeeklySummaryCard({ summary: s, switchPath, compact = false }: {
  summary: WeeklySummary;
  switchPath?: string;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const f = useWeeklyFormat();
  const w = t.common.weekly;
  const cur = s.current;
  const n = cur.nutrition;
  const p = cur.progress;
  const c = cur.consistency;
  const hasNutrition = n.avg !== null;
  const hasProgress = p.weight !== null || p.waist !== null || Object.keys(p.others).length > 0;
  const kg = (v: number) => `${f.n(v)} kg`;

  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{w.title}</p>
          <p className="mt-0.5 text-sm font-bold">
            {f.date(cur.week.start)} – {f.date(cur.week.end)}
            <span className="ml-2 text-xs font-medium text-ink-faint">
              {s.choice === "current" ? w.currentWeek : w.previousWeek}
            </span>
          </p>
        </div>
        {switchPath ? (
          <div className="flex overflow-hidden rounded-lg border border-line text-xs font-semibold">
            {(["previous", "current"] as const).map((choice) => (
              <Link
                key={choice}
                href={`${switchPath}?week=${choice}`}
                scroll={false}
                className={`px-3 py-1.5 ${s.choice === choice ? "bg-accent text-accent-fg" : "text-ink-soft hover:text-ink"}`}
              >
                {choice === "current" ? w.currentWeek : w.previousWeek}
              </Link>
            ))}
          </div>
        ) : null}
      </div>

      {/* Insight sits at the top: it is the sentence the numbers below justify. */}
      <ul className="mt-3 space-y-1">
        {s.insights.map((i, idx) => (
          <li key={idx} className={`text-sm leading-snug ${idx === 0 ? "font-semibold text-accent-ink" : "text-ink-soft"}`}>
            {insightText(i, t, f)}
          </li>
        ))}
      </ul>

      <div className={`mt-4 space-y-4 ${compact ? "" : "lg:grid lg:grid-cols-2 lg:gap-x-8 lg:space-y-0 lg:[&>section]:mt-4"}`}>
        <Section title={w.training}>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Stat label={w.workouts} value={f.n(cur.training.workouts)} delta={s.training.workouts} format={f.n} />
            <Stat
              label={w.duration}
              value={cur.training.duration_min > 0 ? f.duration(cur.training.duration_min) : "—"}
              delta={cur.training.duration_min > 0 ? s.training.duration_min : null}
              format={f.duration}
            />
            <Stat label={w.trainingLoad} value={f.n(cur.training.load)} delta={s.training.load} format={f.n} />
            <Stat label={w.volume} value={f.n(cur.training.volume_kg)} unit="kg" delta={s.training.volume_kg} format={kg} />
            <Stat label={w.sets} value={f.n(cur.training.sets)} delta={s.training.sets} format={f.n} />
            <Stat label={w.exercises} value={f.n(cur.training.exercises)} delta={s.training.exercises} format={f.n} />
          </div>
          {cur.training.prs > 0 ? (
            <div className="mt-3 rounded-lg bg-accent-soft px-3 py-2">
              <p className="text-sm font-semibold text-accent-ink">
                {cur.training.prs === 1 ? w.newPrOne : fill(w.newPrs, { count: cur.training.prs })}
              </p>
              <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-ink-soft">
                {cur.training.pr_lifts.slice(0, 6).map((pr, i) => (
                  <li key={i} className="tabular-nums">
                    <span className="font-semibold text-ink">{pr.exercise}</span> {f.n1(pr.weight_kg)} kg × {pr.reps}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Section>

        <Section title={w.nutrition}>
          {hasNutrition && n.avg ? (
            <>
              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                <Stat label={w.kcalPerDay} value={f.n(n.avg.kcal)} delta={s.nutrition.kcal} format={f.n} />
                <Stat label={w.proteinPerDay} value={f.n(n.avg.protein)} delta={s.nutrition.protein} format={f.n} />
                <Stat label={w.carbsPerDay} value={f.n(n.avg.carbs)} delta={s.nutrition.carbs} format={f.n} />
                <Stat label={w.fatPerDay} value={f.n(n.avg.fat)} delta={s.nutrition.fat} format={f.n} />
                <Stat
                  label={w.adherence}
                  value={n.adherence_pct === null ? w.noData : `${n.adherence_pct}%`}
                  delta={n.adherence_pct === null ? null : s.nutrition.adherence_pct}
                  format={(v) => `${v}%`}
                />
              </div>
              <p className="mt-2 text-[11px] text-ink-faint">{fill(w.daysLogged, { count: n.days_logged })}</p>
            </>
          ) : (
            <p className="text-sm text-ink-faint">{w.noData}</p>
          )}
        </Section>

        <Section title={w.progress}>
          {hasProgress ? (
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              {p.weight ? (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{w.weight}</p>
                  <p className="mt-0.5 text-xl font-bold tabular-nums leading-tight">
                    {f.signed(p.weight.delta)} <span className="text-xs font-medium text-ink-faint">kg</span>
                  </p>
                  <p className="mt-0.5 text-[11px] tabular-nums text-ink-faint">
                    {f.n1(p.weight.start)} → {f.n1(p.weight.end)} kg
                  </p>
                </div>
              ) : null}
              {p.waist ? (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{w.waist}</p>
                  <p className="mt-0.5 text-xl font-bold tabular-nums leading-tight">
                    {f.signed(p.waist.delta)} <span className="text-xs font-medium text-ink-faint">cm</span>
                  </p>
                  <p className="mt-0.5 text-[11px] tabular-nums text-ink-faint">
                    {f.n1(p.waist.start)} → {f.n1(p.waist.end)} cm
                  </p>
                </div>
              ) : null}
              {Object.entries(p.others).map(([name, ch]) => (
                <div key={name}>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{name}</p>
                  <p className="mt-0.5 text-xl font-bold tabular-nums leading-tight">
                    {f.signed(ch.delta)} <span className="text-xs font-medium text-ink-faint">cm</span>
                  </p>
                  <p className="mt-0.5 text-[11px] tabular-nums text-ink-faint">
                    {f.n1(ch.start)} → {f.n1(ch.end)} cm
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-ink-faint">{w.noData}</p>
          )}
        </Section>

        <Section title={w.consistency}>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            {c.completion_pct !== null ? (
              <Stat
                label={w.plannedWorkouts}
                value={`${cur.training.workouts} / ${c.planned_workouts}`}
                unit={`· ${c.completion_pct}%`}
                delta={s.consistency.completion_pct}
                format={(v) => `${v}%`}
              />
            ) : null}
            <Stat label={w.activeDays} value={`${c.active_days} / 7`} delta={s.consistency.active_days} format={f.n} />
            <Stat label={w.workoutDays} value={f.n(c.workout_days)} delta={s.consistency.workout_days} format={f.n} />
            {c.streak_days > 0 ? <Stat label={w.streak} value={f.n(c.streak_days)} unit={w.streakDays} /> : null}
          </div>
          {c.completion_pct !== null ? (
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-bg">
              <div className={`h-full rounded-full ${c.completion_pct >= 80 ? "bg-accent" : c.completion_pct >= 50 ? "bg-warn" : "bg-risk"}`} style={{ width: `${c.completion_pct}%` }} />
            </div>
          ) : null}
        </Section>
      </div>
    </Card>
  );
}
