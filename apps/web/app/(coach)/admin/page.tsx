import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminStats, getProfile, searchUsers } from "@/lib/data";
import { Card } from "@/components/ui";
import { NavIcon } from "@/components/client-nav";
import { AdminTabs } from "@/components/admin-tabs";
import { TIER_LABEL } from "@/lib/entitlements";
import { AdminTierSelect } from "@/components/billing";
import { getI18n } from "@/lib/i18n/server";
import { fill } from "@/lib/i18n";

const SEARCH = "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16M21 21l-4.3-4.3";

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
    <div className="mx-auto max-w-[1600px]">
      <AdminTabs current="users" />
      <header className="mt-4">
        <h1 className="font-display text-2xl font-extrabold tracking-tight sm:text-[28px]">{t.common.nav.admin}</h1>
      </header>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:mt-6 sm:grid-cols-4 sm:gap-4">
        <Counter icon={ICON.users} label={t.coachApp.admin.totalUsers} value={stats.total_users} />
        <Counter icon={ICON.whistle} label={t.coachApp.admin.coaches} value={stats.coaches} />
        <Counter icon={ICON.person} label={t.coachApp.admin.clients} value={stats.clients} />
        <Counter icon={ICON.link} label={t.coachApp.admin.activePairs} value={stats.active_relationships} />
      </div>

      <div className="mt-4 grid items-start gap-4 sm:mt-5 lg:grid-cols-[300px_1fr] lg:gap-6">
        <Card plain>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            {t.coachApp.admin.activeSubscriptions}
          </p>
          <div className="mt-3 divide-y divide-line/60">
            {stats.tiers.map((tier) => (
              <div key={tier.tier} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                <span className="text-sm text-ink-soft">{TIER_LABEL[tier.tier]}</span>
                <span className="font-display text-[17px] font-extrabold tabular-nums leading-none">{tier.count}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card plain className="overflow-hidden p-0">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-[18px]">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
              {results ? fill(t.coachApp.admin.resultsFor, { q: query }) : t.coachApp.admin.newestUsers}
            </p>
            <form action="/admin" method="GET" className="flex flex-wrap items-center gap-2">
              <label className="flex h-[42px] items-center gap-2.5 rounded-2xl bg-bg px-3.5">
                <NavIcon d={SEARCH} className="h-[17px] w-[17px] shrink-0 text-ink-faint" />
                <input
                  type="search"
                  name="q"
                  defaultValue={query}
                  placeholder={t.coachApp.admin.searchPlaceholder}
                  aria-label={t.coachApp.admin.searchPlaceholder}
                  className="w-44 min-w-0 bg-transparent text-sm outline-none placeholder:text-ink-faint"
                />
              </label>
              <button
                type="submit"
                className="flex h-[42px] items-center justify-center rounded-2xl bg-accent px-5 font-display text-sm font-bold text-accent-fg hover:opacity-90"
              >
                {t.coachApp.admin.searchButton}
              </button>
              {query ? (
                <Link href="/admin" className="inline-flex h-9 items-center rounded-full px-2 text-[12.5px] font-semibold text-ink-soft hover:text-ink">
                  {t.coachApp.admin.clearSearch}
                </Link>
              ) : null}
            </form>
          </div>
          {results && results.length === 0 ? (
            <p className="px-5 py-8 text-sm text-ink-soft">
              {fill(t.coachApp.admin.noResults, { q: query })}
            </p>
          ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-ink-faint">
                  <th className="px-6 pb-2 pt-1 font-semibold">{t.coachApp.admin.thName}</th>
                  <th className="px-3 pb-2 pt-1 font-semibold">{t.coachApp.admin.thRole}</th>
                  <th className="px-3 pb-2 pt-1 font-semibold">{t.coachApp.admin.thTier}</th>
                  <th className="px-6 pb-2 pt-1 font-semibold">{t.coachApp.admin.thJoined}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {rows.map((u) => (
                  <tr key={u.id} className="align-middle">
                    <td className="py-4 pl-6 pr-3">
                      <span className="flex items-center gap-3">
                        <span
                          aria-hidden
                          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent-soft font-display text-sm font-bold text-accent-ink"
                        >
                          {u.full_name.trim().charAt(0).toUpperCase()}
                        </span>
                        <span className="text-[15px] font-semibold">{u.full_name}</span>
                      </span>
                    </td>
                    <td className="px-3 py-4">
                      <span className="inline-flex rounded-full bg-bg px-2.5 py-1 text-[11px] font-semibold text-ink-soft">
                        {t.coachApp.admin.roles[u.role] ?? u.role}
                      </span>
                    </td>
                    <td className="px-3 py-4">
                      <AdminTierSelect userId={u.id} tier={u.tier} />
                    </td>
                    <td className="whitespace-nowrap py-4 pl-3 pr-6 text-[13px] tabular-nums text-ink-faint">
                      {new Date(u.created_at).toLocaleDateString(locale)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
          {results && results.length >= 50 ? (
            <p className="px-5 pb-[18px] pt-3 text-[12.5px] text-ink-faint">{t.coachApp.admin.searchCapped}</p>
          ) : null}
        </Card>
      </div>
      <p className="mt-4 text-[12.5px] text-ink-faint">
        {t.coachApp.admin.searchHint}
      </p>
      <p className="mt-1 text-[12.5px] text-ink-faint">
        {t.coachApp.admin.footnote}
      </p>
    </div>
  );
}

/** The 24-box icon paths this screen uses. */
const ICON = {
  users: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M2 20a7 7 0 0 1 14 0M17 11a3 3 0 0 0 0-6M18 20h4a6 6 0 0 0-3-5.2",
  whistle: "M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4",
  person: "M12 4a4 4 0 1 0 0 8 4 4 0 1 0 0-8M4 21a8 8 0 0 1 16 0",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
} as const;

/** One counter tile: the label as an eyebrow, the number as the figure. */
function Counter({ icon, label, value }: { icon: string; label: string; value: number }) {
  return (
    <div className="flex flex-col items-center gap-2.5 rounded-3xl bg-surface px-4 py-5 text-center sm:gap-3 sm:py-6">
      <NavIcon d={icon} className="h-10 w-10 shrink-0 text-accent-ink sm:h-12 sm:w-12" />
      <p className="flex min-h-[2.4em] w-full items-center justify-center text-[11px] font-semibold uppercase leading-snug tracking-wider text-ink-faint">
        {label}
      </p>
      <p className="font-display text-[32px] font-extrabold tabular-nums leading-none sm:text-[40px]">{value}</p>
    </div>
  );
}
