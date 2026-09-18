import { getMyMeasurements, getMyPrs, getMySessions } from "@/lib/client-data";
import { getProfile } from "@/lib/data";
import { getMyPhotos } from "@/lib/photos-data";
import { cloudinaryConfigured } from "@/lib/cloudinary";
import { ProgressPhotos } from "@/components/progress-photos";
import { Card, EmptyState } from "@/components/ui";
import { NavIcon } from "@/components/client-nav";
import { Sparkline, WeeklyBars } from "@/components/client-ui";
import { MeasurementForm } from "@/components/measurement-form";
import { timeAgo } from "@/lib/format";
import { getI18n } from "@/lib/i18n/server";
import { cmToDisplay, formatWeight, kgToDisplay, weeklyTotals } from "@healthapp/shared";

/**
 * Progress is a dashboard, not a column: four figures across the top, then the
 * weight trend and the weigh-in form, the personal records, and the log of
 * every measurement — side by side once the window is wide enough, stacked in
 * that same order on a phone (so "add your first weigh-in above" still reads).
 */
export default async function ProgressPage() {
  const { t, locale } = await getI18n();
  const [profile, measurements, prs, sessions, photos] = await Promise.all([
    getProfile(),
    // The whole history, not the default 12 rows: this is the one screen whose
    // job is the long view, and a trend cut off at twelve weigh-ins is a
    // different trend.
    getMyMeasurements(MEASUREMENT_HISTORY),
    getMyPrs(),
    getMySessions(200),
    getMyPhotos(),
  ]);
  // This is a server component, so units come off the profile rather than the
  // client-side UnitsProvider the charts use.
  const weightUnit = profile?.weight_unit ?? "kg";
  const lengthUnit = profile?.length_unit ?? "cm";

  const weights = measurements
    .filter((m) => m.weight_kg !== null)
    .map((m) => ({ label: m.taken_on.slice(5), value: m.weight_kg as number }));
  const waists = measurements
    .filter((m) => m.waist_cm !== null)
    .map((m) => ({ label: m.taken_on.slice(5), value: m.waist_cm as number }));
  const latest = weights.at(-1);
  const totalVolume = sessions.reduce((sum, s) => sum + s.volume_kg, 0);
  const volumeByWeek = weeklyTotals(
    sessions.map((session) => ({ at: session.at, value: session.volume_kg })),
    12,
  );

  return (
    <div className="@container mx-auto max-w-[1600px]">
      <h1 className="font-display text-2xl font-extrabold leading-none tracking-tight sm:text-[28px]">
        {t.common.nav.progress}
      </h1>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:mt-6 sm:gap-4 lg:grid-cols-4">
        <Stat
          icon={ICON.scale}
          label={t.clientApp.progress.currentWeight}
          value={latest ? String(kgToDisplay(latest.value, weightUnit)) : "—"}
          unit={latest ? weightUnit : undefined}
        />
        <Stat icon={ICON.sessions} label={t.clientApp.progress.sessionsLogged} value={String(sessions.length)} />
        {/* Tonnes only make sense in metric, so the total is shown in whatever
            unit the person reads — a big number with separators, no decimal. */}
        <Stat
          icon={ICON.volume}
          label={t.clientApp.progress.totalVolume}
          value={formatWeight(totalVolume, weightUnit, { locale, big: true }).replace(` ${weightUnit}`, "")}
          unit={weightUnit}
        />
        <Stat icon={ICON.trophy} label={t.clientApp.progress.personalRecords} value={String(prs.length)} accent />
      </div>

      <div className="mt-4 grid grid-cols-1 items-start gap-4 sm:mt-6 @3xl:grid-cols-2 @3xl:gap-5 @6xl:grid-cols-3 @6xl:gap-6">
        {/* ---- weight: the trend, then the weigh-in that feeds it ---- */}
        <div className="space-y-4">
          <Card plain>
            <SectionLabel icon={ICON.trend}>{t.clientApp.progress.weightTrend}</SectionLabel>
            <div className="mt-3.5">
              <Sparkline points={weights} />
            </div>
          </Card>

          {/* Waist moves when the scale does not — the reason to log it at all,
              so it gets its own chart rather than only a table column. */}
          {waists.length >= 2 ? (
            <Card plain>
              <SectionLabel icon={ICON.ruler}>{t.clientApp.progress.waistTrend}</SectionLabel>
              <div className="mt-3.5">
                <Sparkline points={waists} kind="length" />
              </div>
            </Card>
          ) : null}

          <MeasurementForm />

          {/* Photos sit with the weigh-in, not in a gallery of their own: they
              answer the same question the scale does, on the weeks it lies. */}
          <ProgressPhotos photos={photos} configured={cloudinaryConfigured()} />
        </div>

        {/* ---- the work behind the numbers ---- */}
        <Card plain>
          <SectionLabel icon={ICON.volume}>{t.clientApp.progress.weeklyVolume}</SectionLabel>
          <p className="mt-1.5 text-[12.5px] text-ink-faint">{t.clientApp.progress.weeklyVolumeHint}</p>
          <div className="mt-3.5">
            <WeeklyBars buckets={volumeByWeek} />
          </div>
        </Card>

        {/* ---- best lifts ---- */}
        <Card plain className="overflow-hidden p-0">
          <div className="px-5 pb-1 pt-[18px]">
            <SectionLabel icon={ICON.trophy}>{t.clientApp.progress.personalRecords}</SectionLabel>
          </div>
          {prs.length === 0 ? (
            <p className="px-5 pb-[18px] pt-2 text-[13px] text-ink-faint">{t.clientApp.progress.noPrs}</p>
          ) : (
            <ul className="mt-1 divide-y divide-line/60">
              {prs.map((pr) => (
                <li key={pr.exercise} className="flex items-center justify-between gap-3 px-5 py-3.5">
                  <span className="min-w-0 truncate text-[14px] font-semibold">{pr.exercise}</span>
                  <span className="shrink-0 text-right">
                    <span className="font-display text-[17px] font-extrabold tabular-nums leading-none">
                      {kgToDisplay(pr.best, weightUnit)}
                      <span className="ml-1 font-sans text-[12px] font-medium text-ink-faint">{weightUnit}</span>
                    </span>
                    <span className="mt-0.5 block text-[11.5px] text-ink-faint">
                      {t.clientApp.progress.est1Rm} · {timeAgo(pr.at, locale)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* ---- every measurement ---- */}
        {measurements.length === 0 ? (
          <EmptyState
            plain
            title={t.clientApp.progress.noMeasurementsTitle}
            hint={t.clientApp.progress.noMeasurementsHint}
          />
        ) : (
          <Card plain className="overflow-hidden p-0">
            <div className="px-5 pb-2 pt-[18px]">
              <SectionLabel icon={ICON.ruler}>{t.clientApp.progress.measurements}</SectionLabel>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[13.5px]">
                <thead>
                  <tr className="border-b border-line/60 text-left text-[11px] uppercase tracking-wider text-ink-faint">
                    <th className="px-5 py-3 font-semibold">{t.clientApp.progress.date}</th>
                    <th className="px-5 py-3 text-right font-semibold">
                      {t.clientApp.progress.weight} ({weightUnit})
                    </th>
                    <th className="px-5 py-3 text-right font-semibold">
                      {t.clientApp.progress.waist} ({lengthUnit})
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/60">
                  {[...measurements].reverse().map((m) => (
                    <tr key={m.id}>
                      <td className="whitespace-nowrap px-5 py-3 tabular-nums text-ink-soft">{m.taken_on}</td>
                      <td className="whitespace-nowrap px-5 py-3 text-right font-semibold tabular-nums">
                        {m.weight_kg !== null ? kgToDisplay(m.weight_kg, weightUnit) : "—"}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 text-right font-semibold tabular-nums">
                        {m.waist_cm !== null ? cmToDisplay(m.waist_cm, lengthUnit) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

/** Far past anyone's weigh-in count, but bounded: an unbounded select is how a
    read that is fine for a year becomes a timeout in the third. */
const MEASUREMENT_HISTORY = 500;

/** The 24-box icon paths this screen uses. */
const ICON = {
  scale: "M12 4a2 2 0 1 0 0 4 2 2 0 1 0 0-4M12 8v3M5 11h14l-2.5 9h-9zM8 14h8",
  sessions: "M2 10v4M22 10v4M5 8v8M19 8v8M8 6v12M16 6v12M8 12h8",
  volume: "M4 19h16M7 19V9M12 19V5M17 19v-6",
  trophy: "M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4",
  trend: "M4 17l5-5 3 3 7-7M15 8h5v5",
  ruler: "M3 9h18v6H3zM7 9v3M11 9v4M15 9v3M19 9v4",
} as const;

/** An eyebrow with its icon — the heading of a block on this screen. */
function SectionLabel({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
      <NavIcon d={icon} className="h-[18px] w-[18px] text-accent-ink" />
      {children}
    </p>
  );
}

/** One headline figure on its own card: an icon, the label, the number, its unit. */
function Stat({
  icon,
  label,
  value,
  unit,
  accent = false,
}: {
  icon: string;
  label: string;
  value: string;
  unit?: string;
  accent?: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-2.5 rounded-3xl bg-surface px-4 py-5 text-center sm:gap-3 sm:py-6">
      <NavIcon d={icon} className="h-10 w-10 shrink-0 text-accent-ink sm:h-12 sm:w-12" />
      <p className="w-full truncate text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{label}</p>
      <p
        className={`font-display text-[32px] font-extrabold tabular-nums leading-none sm:text-[40px] ${
          accent ? "text-accent-ink" : ""
        }`}
      >
        {value}
        {unit ? <span className="ml-1.5 font-sans text-sm font-medium text-ink-faint">{unit}</span> : null}
      </p>
    </div>
  );
}
