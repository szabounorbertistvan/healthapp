import Link from "next/link";
import { getCheckIns, getDashboard } from "@/lib/data";
import { Card, PageTitle, SignalBadge, StatCard, EmptyState } from "@/components/ui";
import { pct, timeAgo } from "@/lib/format";
import { getI18n } from "@/lib/i18n/server";

export default async function DashboardPage() {
  const { t, locale } = await getI18n();
  const [rows, checkIns] = await Promise.all([getDashboard(), getCheckIns()]);
  const atRisk = rows.filter((r) => r.signal === "at_risk").length;
  const unread = rows.reduce((sum, r) => sum + r.unread_messages, 0);

  return (
    <div>
      <PageTitle title={t.coachApp.dashboard.title} />
      <div className="mb-5 flex flex-wrap gap-3">
        <StatCard label={t.coachApp.dashboard.activeClients} value={rows.length} />
        <StatCard label={t.coachApp.dashboard.checkInsToReview} value={checkIns.length} accent={checkIns.length > 0} />
        <StatCard label={t.coachApp.dashboard.unreadMessages} value={unread} accent={unread > 0} />
        <StatCard label={t.coachApp.dashboard.atRisk} value={atRisk} accent={atRisk > 0} />
      </div>

      {rows.length === 0 ? (
        <EmptyState title={t.coachApp.dashboard.emptyTitle} hint={t.coachApp.dashboard.emptyHint} />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-line text-left text-[11px] uppercase tracking-wider text-ink-faint">
                <th className="px-4 py-3">{t.coachApp.dashboard.thClient}</th>
                <th className="px-4 py-3">{t.coachApp.dashboard.thSignal}</th>
                <th className="px-4 py-3">{t.coachApp.dashboard.thWhy}</th>
                <th className="px-4 py-3">{t.coachApp.dashboard.thAdherence}</th>
                <th className="px-4 py-3">{t.coachApp.dashboard.thLastLog}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.client_id} className="border-b border-line last:border-0">
                  <td className="whitespace-nowrap px-4 py-3 font-semibold">{r.full_name}</td>
                  <td className="px-4 py-3"><SignalBadge signal={r.signal} /></td>
                  <td className="min-w-56 px-4 py-3 text-ink-soft">{r.reason}</td>
                  <td className="px-4 py-3 tabular-nums">{pct(r.overall_pct)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink-soft">{timeAgo(r.last_activity, locale)}</td>
                  <td className="px-4 py-3 text-right">
                    {r.pending_checkin ? (
                      <Link href="/check-ins" className="font-semibold text-accent-ink hover:underline">{t.coachApp.dashboard.review}</Link>
                    ) : (
                      <Link href={`/clients?focus=${r.client_id}`} className="font-semibold text-accent-ink hover:underline">{t.coachApp.dashboard.open}</Link>
                    )}
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
