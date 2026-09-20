import { requireAdmin } from "@/lib/admin/guard";
import { getAdminSystemHealth, probeServices } from "@/lib/admin/data";
import { getI18n } from "@/lib/i18n/server";
import { fill } from "@/lib/i18n";
import { AdminHeader, Breakdown, Facts, Kpi, KpiGrid, Note, Pill, Section, Table, Td, Th, fmtDateTime, fmtNum } from "@/components/admin/ui";

export const dynamic = "force-dynamic";

// Admin · system health: what the database can report about itself and the
// jobs, plus a reachability probe of each Supabase service from this server.
export default async function AdminSystemPage() {
  await requireAdmin();
  const [{ t, locale }, h, probes] = await Promise.all([getI18n(), getAdminSystemHealth(), probeServices()]);
  const m = t.admin.system;
  const c = t.admin.common;
  const n = (v: number | null | undefined) => fmtNum(v, locale);

  return (
    <div>
      <AdminHeader title={m.title} intro={m.intro} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section title={m.services} hint={m.probeHint}>
          <ul className="divide-y divide-line/60">
            {probes.map((p) => (
              <li key={p.name} className="flex items-center justify-between gap-3 py-2 text-[13px]">
                <span className="min-w-0">
                  <span className="font-semibold">{p.name}</span>
                  <span className="block truncate font-mono text-[11px] text-ink-faint">{p.url}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2 tabular-nums text-ink-soft">
                  {p.ms !== null ? `${p.ms} ms` : ""}
                  {p.status !== null ? <span className="text-[11px] text-ink-faint">{p.status}</span> : null}
                  <Pill tone={p.ok ? "accent" : "risk"}>{p.ok ? m.reachable : m.unreachable}</Pill>
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-3">
            <Facts items={[
              { label: m.restPush, value: <Pill tone={h.rest_push_configured ? "accent" : "warn"}>{h.rest_push_configured ? m.restPushConfigured : m.restPushMissing}</Pill> },
            ]} />
          </div>
        </Section>

        <Section title={m.database}>
          <Facts items={[
            { label: m.dbNow, value: fmtDateTime(h.db_now, locale) },
            { label: m.dbVersion, value: h.db_version.split(" on ")[0] },
            { label: m.dbSize, value: h.db_size },
            { label: m.migration, value: h.latest_migration ?? c.none, mono: true },
            { label: m.migrations, value: h.migrations_applied ?? c.none },
            { label: m.extensions, value: h.extensions.join(", ") || c.none },
            { label: m.adherence, value: h.adherence_last_computed ? fmtDateTime(h.adherence_last_computed, locale) : c.never },
          ]} />
        </Section>

        <Section title={m.cron} hint={h.cron_runs ? fill(m.cronRuns, { runs: h.cron_runs.runs_24h, failed: h.cron_runs.failed_24h }) : undefined}>
          {h.pg_cron === null ? <Note>{m.noCron}</Note> : (
            <Table empty={h.pg_cron.length === 0 ? c.empty : null} head={<><Th>{m.th.job}</Th><Th>{m.th.schedule}</Th><Th>{m.th.active}</Th><Th>{m.th.lastRun}</Th><Th>{m.th.status}</Th><Th>{m.th.message}</Th></>}>
              {h.pg_cron.map((j) => (
                <tr key={j.name}>
                  <Td className="font-semibold" nowrap>{j.name}</Td>
                  <Td nowrap className="font-mono text-[12px] text-ink-soft">{j.schedule}</Td>
                  <Td nowrap>{j.active ? c.yes : c.no}</Td>
                  <Td nowrap className="text-ink-soft">{fmtDateTime(j.last_start, locale)}</Td>
                  <Td nowrap>{j.last_status ? <Pill tone={j.last_status === "succeeded" ? "accent" : j.last_status === "failed" ? "risk" : "neutral"}>{j.last_status}</Pill> : c.none}</Td>
                  <Td className="max-w-[300px] truncate text-[12px] text-ink-faint"><span title={j.last_message ?? ""}>{j.last_message ?? ""}</span></Td>
                </tr>
              ))}
            </Table>
          )}
        </Section>

        <Section title={m.title}>
          <KpiGrid cols={3}>
            <Kpi label={m.stuck} value={n(h.rest_pushes_stuck)} warn={h.rest_pushes_stuck > 0} />
            <Kpi label={m.unsent} value={n(h.notifications_unsent)} />
            <Kpi label={m.deletionOverdue} value={n(h.deletion_requests_overdue)} warn={h.deletion_requests_overdue > 0} />
            <Kpi label={m.failedLogins} value={n(h.failed_logins_1h)} warn={h.failed_logins_1h > 5} />
            <Kpi label={m.auditTotal} value={n(h.audit_events_total)} />
            <Kpi label={t.admin.overview.errors} value="—" unavailable={m.errorsHint} />
          </KpiGrid>
          <h3 className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{m.counts}</h3>
          <Breakdown data={h.table_counts} locale={locale} />
        </Section>
      </div>
    </div>
  );
}
