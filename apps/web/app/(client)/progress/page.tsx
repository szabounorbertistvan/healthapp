import { getMyMeasurements, getMyPrs, getMySessions } from "@/lib/client-data";
import { Card, EmptyState, PageTitle, StatCard } from "@/components/ui";
import { Sparkline } from "@/components/client-ui";
import { MeasurementForm } from "@/components/measurement-form";
import { timeAgo } from "@/lib/format";
import { getI18n } from "@/lib/i18n/server";

export default async function ProgressPage() {
  const { t, locale } = await getI18n();
  const [measurements, prs, sessions] = await Promise.all([
    getMyMeasurements(),
    getMyPrs(),
    getMySessions(60),
  ]);

  const weights = measurements
    .filter((m) => m.weight_kg !== null)
    .map((m) => ({ label: m.taken_on.slice(5), value: m.weight_kg as number }));
  const latest = weights.at(-1);
  const totalVolume = sessions.reduce((sum, s) => sum + s.volume_kg, 0);

  return (
    <div className="space-y-4">
      <PageTitle title={t.common.nav.progress} />

      <div className="flex flex-wrap gap-4">
        <StatCard label={t.clientApp.progress.currentWeight} value={latest ? `${latest.value} kg` : "—"} />
        <StatCard label={t.clientApp.progress.sessionsLogged} value={sessions.length} />
        <StatCard label={t.clientApp.progress.totalVolume} value={`${Math.round(totalVolume / 1000)} t`} />
        <StatCard label={t.clientApp.progress.personalRecords} value={prs.length} accent />
      </div>

      <Card>
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
          {t.clientApp.progress.weightTrend}
        </p>
        <Sparkline points={weights} />
      </Card>

      <MeasurementForm />

      <Card>
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
          {t.clientApp.progress.personalRecords}
        </p>
        {prs.length === 0 ? (
          <p className="text-sm text-ink-faint">{t.clientApp.progress.noPrs}</p>
        ) : (
          <ul className="divide-y divide-line">
            {prs.map((pr) => (
              <li key={pr.exercise} className="flex items-baseline justify-between gap-3 py-2">
                <span className="min-w-0 truncate text-sm font-semibold">{pr.exercise}</span>
                <span className="shrink-0 text-sm tabular-nums">
                  <b>{pr.best}</b> kg
                  <span className="ml-2 text-xs text-ink-faint">
                    {t.clientApp.progress.est1Rm} · {timeAgo(pr.at, locale)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {measurements.length === 0 ? (
        <EmptyState
          title={t.clientApp.progress.noMeasurementsTitle}
          hint={t.clientApp.progress.noMeasurementsHint}
        />
      ) : (
        <Card className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-ink-faint">
                <th className="px-4 py-3 font-semibold">{t.clientApp.progress.date}</th>
                <th className="px-4 py-3 text-right font-semibold">{t.clientApp.progress.weight}</th>
                <th className="px-4 py-3 text-right font-semibold">{t.clientApp.progress.waist}</th>
              </tr>
            </thead>
            <tbody>
              {[...measurements].reverse().map((m) => (
                <tr key={m.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-2.5">{m.taken_on}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {m.weight_kg !== null ? `${m.weight_kg} kg` : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {m.waist_cm !== null ? `${m.waist_cm} cm` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
