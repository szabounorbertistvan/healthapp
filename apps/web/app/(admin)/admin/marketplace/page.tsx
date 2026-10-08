import { requireAdmin } from "@/lib/admin/guard";
import type { Search } from "@/lib/admin/params";
import { fill } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import { getAdminMarketplaceAnalytics, getAdminRanking } from "@/lib/admin/marketplace-data";
import { RankingTable } from "@/components/admin/ranking-table";
import { AdminHeader, FilterButtons, Kpi, KpiGrid, Note, Section, Table, Td, Th, fmtDate, fmtNum } from "@/components/admin/ui";

export const dynamic = "force-dynamic";

const FUNNEL = [
  "directory_view", "search", "filter_applied", "profile_view", "service_view", "share", "cta_contact", "cta_book", "cta_save",
  "cta_full_profile", "login_required", "signup_started", "signup_completed", "request_sent", "request_accepted", "coaching_started",
  "booking_created", "booking_completed", "review_submitted", "coach_saved",
] as const;

/**
 * Admin · marketplace (20261110120000 + 20261110130000): the aggregate
 * analytics — coaches now, the last 30 days, a weekly trend, the measured
 * funnel and sources — and the ranking inspector, which runs the public
 * search's own ranking (coach_ranked) and shows the parts behind each
 * position. No conversion percentages: the funnel's steps are counts.
 */
export default async function AdminMarketplacePage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireAdmin();
  const { t, locale } = await getI18n();
  const m = t.admin.marketplace;
  const c = t.admin.common;
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.slice(0, 120) : "";
  const city = typeof params.city === "string" ? params.city.slice(0, 60) : "";
  const [a, ranking] = await Promise.all([getAdminMarketplaceAnalytics(12), getAdminRanking({ query: q, city, limit: 50 })]);

  return (
    <div>
      <AdminHeader title={m.title} intro={m.intro} />
      {!a ? <Note>{c.loadError}</Note> : (
        <>
          <p className="mb-3 text-[12.5px] text-ink-faint" data-testid="admin-marketplace-since">
            {a.tracking_since ? fill(m.since, { date: fmtDate(a.tracking_since, locale) }) : m.notTracked}
          </p>
          <Section title={m.title}>
            <KpiGrid cols={4}>
              {(["public", "verified", "accepting", "active"] as const).map((k) => (
                <Kpi key={k} label={m.coaches[k]} value={fmtNum(a.coaches[k], locale)} accent={k === "public"} />
              ))}
            </KpiGrid>
          </Section>
          <div className="mt-4">
            <Section title={m.last30}>
              <KpiGrid cols={4}>
                {(Object.keys(m.m) as (keyof typeof m.m)[]).map((k) => (
                  <Kpi key={k} label={m.m[k]} value={fmtNum(a.last30[k] ?? 0, locale)} />
                ))}
              </KpiGrid>
            </Section>
          </div>
          <div className="mt-4">
            <Section title={m.weekly}>
              <Table empty={null} head={<><Th>{m.week}</Th><Th>{m.m.profile_views}</Th><Th>{m.m.signups}</Th><Th>{m.m.requests}</Th><Th>{m.m.bookings}</Th><Th>{m.m.coaching_started}</Th><Th>{m.m.reviews}</Th></>}>
                {a.weekly.map((w) => (
                  <tr key={w.week} data-testid="admin-marketplace-week">
                    <Td nowrap>{fmtDate(w.week, locale)}</Td>
                    <Td>{fmtNum(w.profile_views, locale)}</Td><Td>{fmtNum(w.signups, locale)}</Td><Td>{fmtNum(w.requests, locale)}</Td>
                    <Td>{fmtNum(w.bookings, locale)}</Td><Td>{fmtNum(w.coaching_started, locale)}</Td><Td>{fmtNum(w.reviews, locale)}</Td>
                  </tr>
                ))}
              </Table>
            </Section>
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Section title={m.funnel} hint={m.funnelHint}>
              <ol className="grid gap-1" data-testid="admin-marketplace-funnel">
                {FUNNEL.map((step) => (
                  <li key={step} className="flex items-center justify-between rounded-xl bg-bg px-3 py-2 text-[13px]">
                    <span>{m.steps[step]}</span>
                    <span className="font-semibold tabular-nums">{fmtNum(a.funnel?.[step] ?? 0, locale)}</span>
                  </li>
                ))}
              </ol>
            </Section>
            <Section title={m.filtersUsed}>
              {(a.filters ?? []).length === 0 ? <Note>{m.notTracked}</Note> : (
                <ol className="grid gap-1" data-testid="admin-marketplace-filters">
                  {(a.filters ?? []).map((f) => (
                    <li key={f.filter} className="flex items-center justify-between rounded-xl bg-bg px-3 py-2 text-[13px]">
                      <span>{m.filterNames[f.filter as keyof typeof m.filterNames] ?? f.filter}</span>
                      <span className="font-semibold tabular-nums">{fmtNum(f.n, locale)}</span>
                    </li>
                  ))}
                </ol>
              )}
              <h3 className="mt-4 text-[12px] font-semibold uppercase tracking-wider text-ink-faint">{m.loginWalls}</h3>
              {(a.login_walls ?? []).length === 0 ? <Note>{m.notTracked}</Note> : (
                <ol className="mt-2 grid gap-1">
                  {(a.login_walls ?? []).map((w) => (
                    <li key={w.wanted} className="flex items-center justify-between rounded-xl bg-bg px-3 py-2 text-[13px]">
                      <span>{m.wanted[w.wanted as keyof typeof m.wanted] ?? w.wanted}</span>
                      <span className="font-semibold tabular-nums">{fmtNum(w.n, locale)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </Section>
            <Section title={m.sources}>
              {a.sources.length === 0 ? <Note>{m.notTracked}</Note> : (
                <Table empty={null} head={<><Th>{m.th.source}</Th><Th>{m.th.views}</Th><Th>{m.th.signups}</Th><Th>{m.th.requests}</Th></>}>
                  {a.sources.map((s) => (
                    <tr key={s.source}>
                      <Td>{s.source === "direct" ? m.direct : s.source}</Td>
                      <Td>{fmtNum(s.views, locale)}</Td><Td>{fmtNum(s.signups, locale)}</Td><Td>{fmtNum(s.requests, locale)}</Td>
                    </tr>
                  ))}
                </Table>
              )}
            </Section>
          </div>
        </>
      )}

      <div className="mt-4">
        <Section title={m.ranking} hint={m.rankingHint}>
          <form action="/admin/marketplace" method="GET" className="mb-4 flex flex-wrap items-end gap-2">
            <label className="grid gap-1 text-[12px] font-semibold text-ink-soft">
              {m.query}
              <input name="q" defaultValue={q} className="h-9 w-64 rounded-xl border border-line bg-bg px-3 text-[13px] text-ink outline-none focus:border-accent" />
            </label>
            <label className="grid gap-1 text-[12px] font-semibold text-ink-soft">
              {m.city}
              <input name="city" defaultValue={city} className="h-9 w-40 rounded-xl border border-line bg-bg px-3 text-[13px] text-ink outline-none focus:border-accent" />
            </label>
            <FilterButtons submit={m.run} clearHref="/admin/marketplace" clear={c.clear} />
          </form>
          {ranking.length === 0 ? <Note>{m.noRanking}</Note> : <RankingTable rows={ranking} />}
        </Section>
      </div>
    </div>
  );
}
