import Link from "next/link";
import { notFound } from "next/navigation";
import { formatWeight, kgToDisplay } from "@healthapp/shared";
import { getMyExerciseHistory } from "@/lib/exercise-history-data";
import { getProfile } from "@/lib/data";
import { getPlan, inHistory } from "@/lib/plan";
import { Card, EmptyState } from "@/components/ui";
import { NavIcon } from "@/components/client-nav";
import { ExerciseVideo } from "@/components/exercise-video";
import { ExerciseTrendChart } from "@/components/exercise-trend-chart";
import { UpgradeHint } from "@/components/upgrade";
import { fill } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";

/**
 * One exercise, as the person has trained it: lifetime bests across the top,
 * the progress line with its metric switch, the rep records (heaviest for at
 * least N reps), and every session set by set — newest first, which is also
 * the table view of the chart. The demo video and the how-to sit at the end.
 *
 * Every number is computed in @healthapp/shared (exercise-history.ts) from the
 * person's own logged_sets; nothing is stored. The chart and the rep records
 * are Premium, the list follows the plan's history window — both inert while
 * the paywall is off.
 */
export default async function ExerciseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [{ t, locale }, view, profile, plan] = await Promise.all([getI18n(), getMyExerciseHistory(id), getProfile(), getPlan()]);
  if (!view) notFound();
  const d = t.clientApp.exerciseDetail;
  const unit = profile?.weight_unit ?? "kg";
  const { exercise, sessions, summary, records } = view;
  const shown = sessions.filter((s) => inHistory(plan, s.at));
  const numberLocale = locale === "ro" ? "ro-RO" : "en-GB";
  // One number style on the page, the chart's included: "157,2" in Romanian.
  const kg = (v: number) => kgToDisplay(v, unit).toLocaleString(numberLocale, { maximumFractionDigits: 1 });
  // Rep records repeat one weight across a run of rep counts until a lighter
  // set takes over; a run reads as one row ("1–11 RM · 115 kg"), not eleven.
  const recordRuns = records.reduce<{ from: number; to: number; weight_kg: number; at: string }[]>((runs, r) => {
    const last = runs.at(-1);
    if (last && last.weight_kg === r.weight_kg && last.at === r.at && last.to === r.reps - 1) last.to = r.reps;
    else runs.push({ from: r.reps, to: r.reps, weight_kg: r.weight_kg, at: r.at });
    return runs;
  }, []);
  const day = (iso: string) =>
    new Date(iso).toLocaleDateString(locale === "ro" ? "ro-RO" : "en-GB", { day: "numeric", month: "short", year: "numeric" });
  const steps = (exercise.instructions ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  return (
    <div className="@container mx-auto max-w-[1600px]">
      <Link
        href="/exercises"
        className="inline-flex h-9 items-center gap-1.5 rounded-full bg-surface pl-3 pr-4 text-[12.5px] font-semibold text-ink-soft hover:text-ink"
      >
        <NavIcon d="m15 6-6 6 6 6" className="h-4 w-4 [stroke-width:2.2]" />
        {d.back}
      </Link>
      <h1 className="mt-4 font-display text-2xl font-extrabold leading-tight tracking-tight sm:text-[28px]">{exercise.name}</h1>
      <p className="mt-1.5 text-[13px] text-ink-faint">
        {[
          exercise.primary_muscles.join(", "),
          exercise.secondary_muscles.length ? `${d.secondary} ${exercise.secondary_muscles.join(", ")}` : null,
          exercise.equipment,
        ].filter(Boolean).join(" · ")}
      </p>

      {sessions.length === 0 ? (
        <div className="mt-5 sm:mt-6">
          <EmptyState plain title={d.history} hint={d.empty} />
        </div>
      ) : (
        <div className={`mt-5 grid grid-cols-2 gap-3 sm:mt-6 sm:gap-4 ${summary.bodyweight ? "lg:grid-cols-3" : "lg:grid-cols-4"}`}>
          {summary.bodyweight ? (
            <>
              <Stat label={d.maxReps} value={String(summary.max_reps?.value ?? 0)} unit={d.repsUnit} sub={summary.max_reps ? day(summary.max_reps.at) : undefined} accent />
              <Stat label={d.sessions} value={String(summary.sessions)} />
              <Stat label={d.sets} value={String(summary.sets)} />
            </>
          ) : (
            <>
              <Stat
                label={d.bestE1rm}
                value={summary.best_e1rm ? kg(summary.best_e1rm.value) : "—"}
                unit={unit}
                sub={summary.best_e1rm ? day(summary.best_e1rm.at) : undefined}
                accent
              />
              <Stat
                label={d.heaviest}
                value={summary.heaviest ? kg(summary.heaviest.weight_kg) : "—"}
                unit={summary.heaviest ? `${unit} × ${summary.heaviest.reps}` : undefined}
                sub={summary.heaviest ? day(summary.heaviest.at) : undefined}
              />
              <Stat
                label={d.bestVolume}
                value={summary.best_session_volume ? formatWeight(summary.best_session_volume.value, unit, { locale, big: true }).replace(` ${unit}`, "") : "—"}
                unit={unit}
                sub={summary.best_session_volume ? day(summary.best_session_volume.at) : undefined}
              />
              <Stat label={d.sessions} value={String(summary.sessions)} sub={fill(d.setsCount, { count: summary.sets })} />
            </>
          )}
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 items-start gap-4 sm:mt-6 @3xl:grid-cols-2 @3xl:gap-5 @6xl:grid-cols-3 @6xl:gap-6">
        {sessions.length > 0 ? (
          <div className="space-y-4 @6xl:col-span-2">
            {plan.e.progressCharts ? (
              <>
                <Card plain>
                  <SectionLabel icon={ICON.trend}>{d.progress}</SectionLabel>
                  <div className="mt-3">
                    <ExerciseTrendChart sessions={sessions} bodyweight={summary.bodyweight} />
                  </div>
                </Card>
                {records.length > 0 ? (
                  <Card plain className="overflow-hidden p-0">
                    <div className="px-5 pb-1 pt-[18px]">
                      <SectionLabel icon={ICON.trophy}>{d.repRecords}</SectionLabel>
                      <p className="mt-1.5 text-[12.5px] text-ink-faint">{d.repRecordsHint}</p>
                    </div>
                    <ul className="mt-2 grid grid-cols-2 divide-line/60 sm:grid-cols-3 @6xl:grid-cols-4">
                      {recordRuns.map((r) => (
                        <li key={r.from} className="border-t border-line/60 px-5 py-3">
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                            {r.from === r.to ? r.from : `${r.from}–${r.to}`} RM
                          </p>
                          <p className="mt-0.5 font-display text-[19px] font-extrabold tabular-nums leading-none">
                            {kg(r.weight_kg)}
                            <span className="ml-1 font-sans text-[12px] font-medium text-ink-faint">{unit}</span>
                          </p>
                          <p className="mt-1 text-[11px] tabular-nums text-ink-faint">{day(r.at)}</p>
                        </li>
                      ))}
                    </ul>
                  </Card>
                ) : null}
              </>
            ) : (
              <UpgradeHint card feature="charts" upgrade={plan.upgrade} />
            )}
          </div>
        ) : null}

        {sessions.length > 0 ? (
          <Card plain className="overflow-hidden p-0 @6xl:row-span-2">
            <div className="flex items-baseline justify-between gap-3 px-5 pb-1 pt-[18px]">
              <SectionLabel icon={ICON.history}>{d.history}</SectionLabel>
              <span className="text-[11.5px] tabular-nums text-ink-faint">
                {sessions.length === 1 ? d.sessionsOne : fill(d.sessionsCount, { count: sessions.length })}
              </span>
            </div>
            <ul className="mt-2 divide-y divide-line/60">
              {shown.map((s) => (
                <li key={s.session_id} className="px-5 py-3.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-[13.5px] font-semibold">{day(s.at)}</p>
                    {!summary.bodyweight && s.best_e1rm > 0 ? (
                      <p className="text-[11.5px] tabular-nums text-ink-faint">
                        {d.metrics.e1rm} {kg(s.best_e1rm)} {unit}
                      </p>
                    ) : null}
                  </div>
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {s.sets.map((set) => (
                      <li
                        key={set.set_index}
                        className={`rounded-full px-2.5 py-1 text-[12px] font-semibold tabular-nums ${
                          set.is_pr ? "bg-accent-soft text-accent-ink" : "bg-bg text-ink-soft"
                        }`}
                      >
                        {set.weight_kg > 0 ? `${kg(set.weight_kg)} × ${set.reps}` : `${set.reps} ${d.repsUnit}`}
                        {set.is_pr ? <span className="ml-1 text-[10px] font-bold uppercase">{d.pr}</span> : null}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
            {shown.length < sessions.length ? (
              <UpgradeHint
                feature="history"
                upgrade={plan.upgrade}
                values={{ days: plan.e.historyDays ?? 0 }}
                className="mx-4 mb-4 mt-1"
              />
            ) : null}
          </Card>
        ) : null}

        <Card plain className={sessions.length > 0 ? "@6xl:col-span-2" : ""}>
          <ExerciseVideo exerciseId={exercise.id} videoUrl={exercise.video_url} source={exercise.video_source} mine={exercise.mine} />
          {steps.length > 0 ? (
            <>
              <div className="mt-5">
                <SectionLabel icon={ICON.steps}>{d.howTo}</SectionLabel>
              </div>
              <ol className="mt-3 space-y-2 text-[13.5px] leading-relaxed text-ink-soft">
                {steps.map((step, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent-soft text-[11px] font-bold tabular-nums text-accent-ink">
                      {i + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </>
          ) : null}
        </Card>
      </div>
    </div>
  );
}

const ICON = {
  trend: "M4 17l5-5 3 3 7-7M15 8h5v5",
  trophy: "M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4",
  history: "M12 7v5l3 2M3.5 12a8.5 8.5 0 1 0 2.5-6M3 4v4h4",
  steps: "M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01",
} as const;

function SectionLabel({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
      <NavIcon d={icon} className="h-[18px] w-[18px] text-accent-ink" />
      {children}
    </p>
  );
}

/** A lifetime best on its own tile: label, the figure with its unit, and when it happened. */
function Stat({ label, value, unit, sub, accent = false }: { label: string; value: string; unit?: string; sub?: string; accent?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-3xl bg-surface px-4 py-5 text-center sm:py-6">
      {/* Wraps rather than truncates: "Cel mai bun 1RM estimat" is two lines on a phone. */}
      <p className="w-full text-balance text-[11px] font-semibold uppercase leading-snug tracking-wider text-ink-faint">{label}</p>
      <p className={`font-display text-[30px] font-extrabold tabular-nums leading-none sm:text-[36px] ${accent ? "text-accent-ink" : ""}`}>
        {value}
        {unit ? <span className="ml-1.5 font-sans text-sm font-medium text-ink-faint">{unit}</span> : null}
      </p>
      {sub ? <p className="text-[11.5px] tabular-nums text-ink-faint">{sub}</p> : null}
    </div>
  );
}
