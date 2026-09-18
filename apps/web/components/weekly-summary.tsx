"use client";
import Link from "next/link";
import type { Delta, Insight } from "@healthapp/shared";
import type { WeeklySummary } from "@/lib/weekly-data";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { useUnits } from "@/lib/units/client";
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
    pctAbs: (v: number) => `${nfp.format(Math.abs(v))}%`,
  };
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

// ---------- rows ----------
// One line per metric: label · value · delta pill. Rows scan; six stacked
// label/number/"vs last week" blocks did not.

function DeltaPill({ d }: { d: Delta | null }) {
  const f = useWeeklyFormat();
  if (!d || d.pct === null) return <span className="w-14 shrink-0" aria-hidden />;
  const tone =
    d.direction === "up" ? "bg-accent-soft text-accent-ink" : d.direction === "down" ? "bg-warn-soft text-warn" : "bg-bg text-ink-faint";
  const arrow = d.direction === "up" ? "▲" : d.direction === "down" ? "▼" : "•";
  return (
    <span className={`inline-flex w-14 shrink-0 items-center justify-end gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${tone}`}>
      <span className="text-[9px]">{arrow}</span>
      {f.pctAbs(d.pct)}
    </span>
  );
}

function Row({ label, value, unit, previous, delta }: {
  label: string;
  value: string;
  unit?: string;
  /** Last week's value, shown muted after the number. */
  previous?: string | null;
  delta?: Delta | null;
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-1.5">
      <span className="min-w-[7rem] flex-1 text-sm leading-snug text-ink-soft">{label}</span>
      <span className="ml-auto shrink-0 text-right text-sm font-bold tabular-nums">
        {value}
        {unit ? <span className="ml-0.5 text-xs font-medium text-ink-faint">{unit}</span> : null}
        {previous ? <span className="ml-1.5 text-[11px] font-medium text-ink-faint">← {previous}</span> : null}
      </span>
      <DeltaPill d={delta ?? null} />
    </li>
  );
}

function Section({ title, aside, children }: { title: string; aside?: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{title}</h3>
        {aside ? <span className="text-[11px] text-ink-faint">{aside}</span> : null}
      </div>
      <ul className="mt-1 divide-y divide-line">{children}</ul>
    </section>
  );
}

/**
 * The week in one card: one headline insight, then four compact sections of
 * rows. Everything comes from @healthapp/shared's comparison; the card only
 * formats. `switchPath` renders the previous / current toggle when the page
 * supports it — a path string, since a function cannot cross the server →
 * client boundary; the card appends ?week=.
 */
export function WeeklySummaryCard({ summary: s, switchPath, compact = false }: {
  summary: WeeklySummary;
  switchPath?: string;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const u = useUnits();
  const f = useWeeklyFormat();
  const w = t.common.weekly;
  const cur = s.current;
  const prev = s.previous;
  const n = cur.nutrition;
  const p = cur.progress;
  const c = cur.consistency;
  const hasProgress = p.weight !== null || p.waist !== null || Object.keys(p.others).length > 0;
  const [headline, ...rest] = s.insights;
  const prevIf = (v: number, show = true) => (show && v > 0 ? f.n(v) : null);

  return (
    // @container: the two-column body below keys off the card's own width,
    // not the viewport's — in Today's third column a `lg:` grid split 400px
    // into two 180px halves and the labels sat on top of the numbers.
    <Card className="@container">
      {/* header: eyebrow + range on the left, the week switch on the right */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{w.title}</p>
          <p className="mt-0.5 truncate text-sm font-bold">
            {f.date(cur.week.start)} – {f.date(cur.week.end)}
          </p>
        </div>
        {switchPath ? (
          <div className="flex shrink-0 overflow-hidden rounded-lg border border-line text-xs font-semibold">
            <Link href={`${switchPath}?week=previous`} scroll={false} aria-label={w.previousWeek}
              className={`min-h-9 px-3 leading-9 ${s.choice === "previous" ? "bg-accent text-accent-fg" : "text-ink-soft hover:text-ink"}`}>
              ‹
            </Link>
            <Link href={`${switchPath}?week=current`} scroll={false}
              className={`min-h-9 px-3 leading-9 ${s.choice === "current" ? "bg-accent text-accent-fg" : "text-ink-soft hover:text-ink"}`}>
              {s.choice === "current" ? w.currentWeek : w.previousWeek}
            </Link>
          </div>
        ) : (
          <span className="shrink-0 text-xs text-ink-faint">{s.choice === "current" ? w.currentWeek : w.previousWeek}</span>
        )}
      </div>

      {/* one headline, the rest as a quiet second line */}
      {headline ? (
        <div className="mt-3 rounded-lg bg-accent-soft px-3 py-2.5">
          <p className="text-sm font-semibold leading-snug text-accent-ink">{insightText(headline, t, f)}</p>
          {rest.length > 0 ? (
            <p className="mt-1 text-xs leading-snug text-ink-soft">{rest.map((i) => insightText(i, t, f)).join(" · ")}</p>
          ) : null}
        </div>
      ) : null}

      <div className={`mt-4 space-y-5 ${compact ? "" : "@2xl:grid @2xl:grid-cols-2 @2xl:gap-x-10 @2xl:gap-y-5 @2xl:space-y-0"}`}>
        <Section title={w.training}>
          <Row label={w.workouts} value={f.n(cur.training.workouts)} previous={prevIf(prev.training.workouts)} delta={s.training.workouts} />
          <Row label={w.duration} value={cur.training.duration_min > 0 ? f.duration(cur.training.duration_min) : "—"}
            previous={prev.training.duration_min > 0 ? f.duration(prev.training.duration_min) : null}
            delta={cur.training.duration_min > 0 ? s.training.duration_min : null} />
          <Row label={w.trainingLoad} value={f.n(cur.training.load)} previous={prevIf(prev.training.load)} delta={s.training.load} />
          <Row label={w.volume} value={f.n(cur.training.volume_kg)} unit="kg" previous={prevIf(prev.training.volume_kg)} delta={s.training.volume_kg} />
          <Row label={w.sets} value={f.n(cur.training.sets)} previous={prevIf(prev.training.sets)} delta={s.training.sets} />
          <Row label={w.exercises} value={f.n(cur.training.exercises)} previous={prevIf(prev.training.exercises)} delta={s.training.exercises} />
          {cur.training.prs > 0 ? (
            <li className="py-2">
              <p className="text-sm font-semibold text-accent-ink">
                {cur.training.prs === 1 ? w.newPrOne : fill(w.newPrs, { count: cur.training.prs })}
              </p>
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {cur.training.pr_lifts.slice(0, 6).map((pr, i) => (
                  <li key={i} className="rounded-md bg-bg px-2 py-1 text-xs tabular-nums text-ink-soft">
                    <span className="font-semibold text-ink">{pr.exercise}</span> {f.n1(pr.weight_kg)} × {pr.reps}
                  </li>
                ))}
              </ul>
            </li>
          ) : null}
        </Section>

        <Section title={w.nutrition} aside={n.avg ? fill(w.daysLogged, { count: n.days_logged }) : undefined}>
          {n.avg ? (
            <>
              <Row label={w.kcalPerDay} value={f.n(n.avg.kcal)} previous={prevIf(prev.nutrition.avg?.kcal ?? 0)} delta={s.nutrition.kcal} />
              <Row label={w.proteinPerDay} value={f.n(n.avg.protein)} previous={prevIf(prev.nutrition.avg?.protein ?? 0)} delta={s.nutrition.protein} />
              <Row label={w.carbsPerDay} value={f.n(n.avg.carbs)} previous={prevIf(prev.nutrition.avg?.carbs ?? 0)} delta={s.nutrition.carbs} />
              <Row label={w.fatPerDay} value={f.n(n.avg.fat)} previous={prevIf(prev.nutrition.avg?.fat ?? 0)} delta={s.nutrition.fat} />
              <Row label={w.adherence} value={n.adherence_pct === null ? w.noData : `${n.adherence_pct}%`}
                previous={prev.nutrition.adherence_pct !== null ? `${prev.nutrition.adherence_pct}%` : null}
                delta={n.adherence_pct === null ? null : s.nutrition.adherence_pct} />
            </>
          ) : (
            <li className="py-1.5 text-sm text-ink-faint">{w.noData}</li>
          )}
        </Section>

        <Section title={w.progress}>
          {hasProgress ? (
            <>
              {p.weight ? (
                <Row
                  label={w.weight}
                  value={f.signed(u.weightValue(p.weight.delta))}
                  unit={u.weightUnit}
                  previous={`${f.n1(u.weightValue(p.weight.start))} → ${f.n1(u.weightValue(p.weight.end))}`}
                />
              ) : null}
              {p.waist ? (
                <Row
                  label={w.waist}
                  value={f.signed(u.lengthValue(p.waist.delta))}
                  unit={u.lengthUnit}
                  previous={`${f.n1(u.lengthValue(p.waist.start))} → ${f.n1(u.lengthValue(p.waist.end))}`}
                />
              ) : null}
              {Object.entries(p.others).map(([name, ch]) => (
                <Row
                  key={name}
                  label={name}
                  value={f.signed(u.lengthValue(ch.delta))}
                  unit={u.lengthUnit}
                  previous={`${f.n1(u.lengthValue(ch.start))} → ${f.n1(u.lengthValue(ch.end))}`}
                />
              ))}
            </>
          ) : (
            <li className="py-1.5 text-sm text-ink-faint">{w.noData}</li>
          )}
        </Section>

        <Section title={w.consistency}>
          {c.completion_pct !== null ? (
            <Row label={w.plannedWorkouts} value={`${cur.training.workouts} / ${c.planned_workouts}`} unit={`· ${c.completion_pct}%`}
              previous={prev.consistency.completion_pct !== null ? `${prev.consistency.completion_pct}%` : null}
              delta={s.consistency.completion_pct} />
          ) : null}
          <Row label={w.activeDays} value={`${c.active_days} / 7`} previous={prevIf(prev.consistency.active_days)} delta={s.consistency.active_days} />
          <Row label={w.workoutDays} value={f.n(c.workout_days)} previous={prevIf(prev.consistency.workout_days)} delta={s.consistency.workout_days} />
          {c.streak_days > 0 ? <Row label={w.streak} value={f.n(c.streak_days)} unit={w.streakDays} /> : null}
          {c.completion_pct !== null ? (
            <li className="pt-2">
              <div className="h-1.5 overflow-hidden rounded-full bg-bg">
                <div className={`h-full rounded-full ${c.completion_pct >= 80 ? "bg-accent" : c.completion_pct >= 50 ? "bg-warn" : "bg-risk"}`} style={{ width: `${c.completion_pct}%` }} />
              </div>
            </li>
          ) : null}
        </Section>
      </div>
    </Card>
  );
}
