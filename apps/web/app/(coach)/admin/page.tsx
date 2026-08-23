import { redirect } from "next/navigation";
import { getAdminStats, getProfile } from "@/lib/data";
import { Card, PageTitle, StatCard } from "@/components/ui";
import { TIER_LABEL } from "@/lib/entitlements";

export default async function AdminPage() {
  const profile = await getProfile();
  if (profile?.role !== "admin") redirect("/dashboard");
  const stats = await getAdminStats();

  return (
    <div>
      <PageTitle title="Admin" />
      <div className="mb-5 flex flex-wrap gap-3">
        <StatCard label="Total users" value={stats.total_users} />
        <StatCard label="Coaches" value={stats.coaches} />
        <StatCard label="Clients" value={stats.clients} />
        <StatCard label="Active coach↔client pairs" value={stats.active_relationships} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <Card>
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            Active subscriptions
          </p>
          <div className="space-y-2">
            {stats.tiers.map((t) => (
              <div key={t.tier} className="flex items-center justify-between text-sm">
                <span>{TIER_LABEL[t.tier]}</span>
                <span className="font-bold tabular-nums">{t.count}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card className="overflow-x-auto p-0">
          <p className="px-4 pt-4 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            Newest users
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-line text-left text-[11px] uppercase tracking-wider text-ink-faint">
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Role</th>
                <th className="px-4 py-2">Tier</th>
                <th className="px-4 py-2">Joined</th>
              </tr>
            </thead>
            <tbody>
              {stats.recent_users.map((u) => (
                <tr key={u.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-2.5 font-semibold">{u.full_name}</td>
                  <td className="px-4 py-2.5 text-ink-soft">{u.role}</td>
                  <td className="px-4 py-2.5">{TIER_LABEL[u.tier]}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-ink-soft">
                    {new Date(u.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
      <p className="mt-4 text-xs text-ink-faint">
        Role changes and content moderation tooling land with V1.2 (coach discovery &amp; reviews).
      </p>
    </div>
  );
}
