import { requireAdmin } from "@/lib/admin/guard";
import { oneOf, type Search } from "@/lib/admin/params";
import { getI18n } from "@/lib/i18n/server";
import { REPORT_KINDS, REPORT_STATUSES, getAdminReports, getReportCounts } from "@/lib/admin/marketplace-data";
import { ReportsTable } from "@/components/admin/reports-table";
import { AdminHeader, FilterButtons, Kpi, KpiGrid, Section, Select, fmtNum } from "@/components/admin/ui";

export const dynamic = "force-dynamic";

/**
 * Admin · reports (20261110110000): the queue of social_reports — the one
 * reporting path for coach profiles, reviews, posts, comments and people.
 * Open first, oldest first. Every read and write is an admin_* RPC.
 */
export default async function AdminReportsPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireAdmin();
  const { t, locale } = await getI18n();
  const r = t.admin.reports;
  const c = t.admin.common;
  const params = await searchParams;
  const kind = oneOf(params, "kind", REPORT_KINDS);
  const status = params.status === "all" ? null : oneOf(params, "status", REPORT_STATUSES) ?? "open";
  const [rows, counts] = await Promise.all([getAdminReports({ kind, status }), getReportCounts()]);
  const n = counts ?? {};
  const href = (k: string) => `/admin/reports?kind=${k}`;

  return (
    <div>
      <AdminHeader title={r.title} intro={r.intro} />
      <Section title={r.kpi.open}>
        <KpiGrid cols={6}>
          <Kpi label={r.kpi.open} value={fmtNum(n.open ?? 0, locale)} href="/admin/reports" warn={(n.open ?? 0) > 0} />
          {REPORT_KINDS.map((k) => (
            <Kpi key={k} label={r.kpi[k]} value={fmtNum(n[k] ?? 0, locale)} href={href(k)} />
          ))}
        </KpiGrid>
      </Section>
      <div className="mt-4">
        <Section title={kind ? r.kinds[kind] : r.title}>
          <form action="/admin/reports" method="GET" className="mb-4 flex flex-wrap items-end gap-2">
            <Select name="kind" value={kind ?? "all"} label={r.filterKind} allLabel={c.all}
              options={[{ value: "all", label: c.all }, ...REPORT_KINDS.map((k) => ({ value: k, label: r.kinds[k] }))]} />
            <Select name="status" value={status ?? "all"} label={r.filterStatus} allLabel={c.all}
              options={[{ value: "all", label: c.all }, ...REPORT_STATUSES.map((s) => ({ value: s, label: r.statuses[s] }))]} />
            <FilterButtons submit={c.filter} clearHref="/admin/reports" clear={c.clear} />
          </form>
          <ReportsTable rows={rows} />
        </Section>
      </div>
    </div>
  );
}
