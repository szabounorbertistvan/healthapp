import { redirect } from "next/navigation";
import { getAdminStats, getProfile } from "@/lib/data";
import { Card, PageTitle, StatCard } from "@/components/ui";
import { TIER_LABEL } from "@/lib/entitlements";
import { AdminTierSelect } from "@/components/billing";
import { getI18n } from "@/lib/i18n/server";

export default async function AdminPage() {
  const { t, locale } = await getI18n();
  const profile = await getProfile();
  if (profile?.role !== "admin") redirect("/dashboard");
  const stats = await getAdminStats();

  return (
    <div>
      <PageTitle title={t.common.nav.admin} />
      <div className="mb-5 flex flex-wrap gap-3">
        <StatCard label={t.coachApp.admin.totalUsers} value={stats.total_users} />
        <StatCard label={t.coachApp.admin.coaches} value={stats.coaches} />
        <StatCard label={t.coachApp.admin.clients} value={stats.clients} />
        <StatCard label={t.coachApp.admin.activePairs} value={stats.active_relationships} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <Card>
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            {t.coachApp.admin.activeSubscriptions}
          </p>
          <div className="space-y-2">
            {stats.tiers.map((tier) => (
              <div key={tier.tier} className="flex items-center justify-between text-sm">
                <span>{TIER_LABEL[tier.tier]}</span>
                <span className="font-bold tabular-nums">{tier.count}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card className="overflow-x-auto p-0">
          <p className="px-4 pt-4 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            {t.coachApp.admin.newestUsers}
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-line text-left text-[11px] uppercase tracking-wider text-ink-faint">
                <th className="px-4 py-2">{t.coachApp.admin.thName}</th>
                <th className="px-4 py-2">{t.coachApp.admin.thRole}</th>
                <th className="px-4 py-2">{t.coachApp.admin.thTier}</th>
                <th className="px-4 py-2">{t.coachApp.admin.thJoined}</th>
              </tr>
            </thead>
            <tbody>
              {stats.recent_users.map((u) => (
                <tr key={u.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-2.5 font-semibold">{u.full_name}</td>
                  <td className="px-4 py-2.5 text-ink-soft">{t.coachApp.admin.roles[u.role] ?? u.role}</td>
                  <td className="px-4 py-2.5">
                    <AdminTierSelect userId={u.id} tier={u.tier} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-ink-soft">
                    {new Date(u.created_at).toLocaleDateString(locale)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
      <p className="mt-4 text-xs text-ink-faint">
        {t.coachApp.admin.footnote}
      </p>
    </div>
  );
}
