import { getMyMeasurements, getMyPrs, getMySessions } from "@/lib/client-data";
import { Card, EmptyState, PageTitle, StatCard } from "@/components/ui";
import { Sparkline } from "@/components/client-ui";
import { MeasurementForm } from "@/components/measurement-form";
import { timeAgo } from "@/lib/format";

export default async function ProgressPage() {
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
      <PageTitle title="Progress" />

      <div className="flex flex-wrap gap-4">
        <StatCard label="Current weight" value={latest ? `${latest.value} kg` : "—"} />
        <StatCard label="Sessions logged" value={sessions.length} />
        <StatCard label="Total volume" value={`${Math.round(totalVolume / 1000)} t`} />
        <StatCard label="Personal records" value={prs.length} accent />
      </div>

      <Card>
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
          Weight trend
        </p>
        <Sparkline points={weights} />
      </Card>

      <MeasurementForm />

      <Card>
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
          Personal records
        </p>
        {prs.length === 0 ? (
          <p className="text-sm text-ink-faint">Log some sets and your best lifts appear here.</p>
        ) : (
          <ul className="divide-y divide-line">
            {prs.map((pr) => (
              <li key={pr.exercise} className="flex items-baseline justify-between gap-3 py-2">
                <span className="min-w-0 truncate text-sm font-semibold">{pr.exercise}</span>
                <span className="shrink-0 text-sm tabular-nums">
                  <b>{pr.best}</b> kg
                  <span className="ml-2 text-xs text-ink-faint">est. 1RM · {timeAgo(pr.at)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {measurements.length === 0 ? (
        <EmptyState title="No measurements yet" hint="Add your first weigh-in above." />
      ) : (
        <Card className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-ink-faint">
                <th className="px-4 py-3 font-semibold">Date</th>
                <th className="px-4 py-3 text-right font-semibold">Weight</th>
                <th className="px-4 py-3 text-right font-semibold">Waist</th>
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
