import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminStats, getProfile, searchUsers } from "@/lib/data";
import { Card, PageTitle, StatCard } from "@/components/ui";
import { TIER_LABEL } from "@/lib/entitlements";
import { AdminTierSelect } from "@/components/billing";
import { getI18n } from "@/lib/i18n/server";
import { fill } from "@/lib/i18n";

// Search is a plain GET form rather than a client component: the result list is
// a server read, and ?q= in the URL means an admin can link or reload a lookup.
export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { t, locale } = await getI18n();
  const profile = await getProfile();
  if (profile?.role !== "admin") redirect("/dashboard");
  const stats = await getAdminStats();

  const query = (await searchParams).q?.trim() ?? "";
  const results = query ? await searchUsers(query) : null;
  const rows = results ?? stats.recent_users;

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
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
              {results ? fill(t.coachApp.admin.resultsFor, { q: query }) : t.coachApp.admin.newestUsers}
            </p>
            <form action="/admin" method="GET" className="flex items-center gap-2">
              <input
                type="search"
                name="q"
                defaultValue={query}
                placeholder={t.coachApp.admin.searchPlaceholder}
                aria-label={t.coachApp.admin.searchPlaceholder}
                className="w-48 rounded-lg border border-line bg-bg px-3 py-1.5 text-sm outline-none focus:border-accent"
              />
              <button
                type="submit"
                className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-fg hover:opacity-90"
              >
                {t.coachApp.admin.searchButton}
              </button>
              {query ? (
                <Link href="/admin" className="text-xs text-ink-soft hover:underline">
                  {t.coachApp.admin.clearSearch}
                </Link>
              ) : null}
            </form>
          </div>
          {results && results.length === 0 ? (
            <p className="px-4 py-6 text-sm text-ink-soft">
              {fill(t.coachApp.admin.noResults, { q: query })}
            </p>
          ) : (
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
              {rows.map((u) => (
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
          )}
          {results && results.length >= 50 ? (
            <p className="px-4 pb-4 text-xs text-ink-faint">{t.coachApp.admin.searchCapped}</p>
          ) : null}
        </Card>
      </div>
      <p className="mt-4 text-xs text-ink-faint">
        {t.coachApp.admin.searchHint}
      </p>
      <p className="mt-1 text-xs text-ink-faint">
        {t.coachApp.admin.footnote}
      </p>
    </div>
  );
}
