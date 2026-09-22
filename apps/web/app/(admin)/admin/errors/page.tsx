import { requireAdmin } from "@/lib/admin/guard";
import { getAdminAppErrors } from "@/lib/admin/data";
import { DAY_WINDOWS, PAGE_SIZE, daysOf, listHref, oneOf, pageOf, paging, searchOf, type Search } from "@/lib/admin/params";
import { getI18n } from "@/lib/i18n/server";
import { fill } from "@/lib/i18n";
import { resolveAppError } from "@/app/admin-actions";
import { ConfirmAction } from "@/components/admin/confirm-action";
import {
  AdminHeader, DaysPicker, FilterButtons, Kpi, KpiGrid, Note, Pager, Pill, SearchInput, Section,
  Select, Table, Td, Th, UserCell, fmtDateTime, fmtNum,
} from "@/components/admin/ui";

const SOURCES = ["client", "server", "edge"] as const;
const STATUSES = ["open", "resolved"] as const;

export const dynamic = "force-dynamic";

/**
 * Admin · application errors. The store behind the tile that used to read
 * "—": every error an error boundary caught, folded by message first (which
 * one is actually happening) and then listed raw. Resolving is the only write,
 * and it marks rather than deletes — the log is append-only like the audit one.
 */
export default async function AdminErrorsPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireAdmin();
  const { t, locale } = await getI18n();
  const m = t.admin.errors;
  const c = t.admin.common;
  const params = await searchParams;
  const days = daysOf(params);
  const source = oneOf(params, "source", SOURCES);
  const status = oneOf(params, "status", STATUSES);
  const q = searchOf(params);
  const page = pageOf(params);
  const current = { days, source, status, q, page };
  const n = (v: number | null | undefined) => fmtNum(v, locale);

  const { stats, groups, total, rows } = await getAdminAppErrors({
    days, source, status, search: q, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE,
  });
  const pg = paging(total, page, PAGE_SIZE);
  const sourceLabel: Record<string, string> = { client: m.fromClient, server: m.fromServer, edge: m.fromEdge };

  return (
    <div>
      <AdminHeader title={m.title} intro={m.intro}>
        <DaysPicker days={days} options={DAY_WINDOWS} href={(d) => listHref("/admin/errors", current, { days: d, page: 1 })} label={(d) => fill(c.days, { n: d })} />
      </AdminHeader>

      <Section title={m.title}>
        <KpiGrid cols={6}>
          <Kpi label={m.windowErrors} value={n(stats.window)} accent warn={stats.window > 0} href={listHref("/admin/errors", current, { page: 1 })} />
          <Kpi label={m.last24h} value={n(stats.last_24h)} warn={stats.last_24h > 0} />
          <Kpi label={m.lastHour} value={n(stats.last_1h)} warn={stats.last_1h > 0} />
          <Kpi label={m.open} value={n(stats.open)} warn={stats.open > 0} href={listHref("/admin/errors", current, { status: "open", page: 1 })} />
          <Kpi label={m.fromClient} value={n(stats.client)} href={listHref("/admin/errors", current, { source: "client", page: 1 })} />
          <Kpi label={m.fromServer} value={n(stats.server)} href={listHref("/admin/errors", current, { source: "server", page: 1 })} />
          <Kpi label={m.fromEdge} value={n(stats.edge)} href={listHref("/admin/errors", current, { source: "edge", page: 1 })} />
          <Kpi label={m.usersAffected} value={n(stats.users)} />
          <Kpi label={m.totalEver} value={n(stats.total)} />
          <Kpi label={m.lastAt} value={<span className="text-[15px]">{fmtDateTime(stats.last_at, locale)}</span>} />
        </KpiGrid>
      </Section>

      {groups.length > 0 ? (
        <div className="mt-4">
          <Section title={m.topMessages}>
            <ul className="divide-y divide-line/60">
              {groups.map((g) => (
                <li key={g.message} className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold" title={g.message}>{g.message}</span>
                    <span className="mt-0.5 block text-[11.5px] text-ink-faint">
                      {g.sources.map((s) => sourceLabel[s] ?? s).join(" · ")} · {fmtDateTime(g.last_at, locale)}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <Pill tone={g.open > 0 ? "risk" : "neutral"}>{fill(m.occurrences, { n: n(g.count) })}</Pill>
                    {g.open > 0 ? (
                      <ConfirmAction
                        label={m.resolveAll}
                        title={m.resolveTitle}
                        body={m.resolveAllBody}
                        tone="neutral"
                        action={resolveAppError.bind(null, g.sample_id, true)}
                      />
                    ) : (
                      <Pill tone="accent">{m.resolved}</Pill>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      ) : null}

      <div className="mt-4">
        <Section title={`${n(total)} · ${m.recent}`}>
          <form action="/admin/errors" method="GET" className="mb-4 flex flex-wrap items-end gap-2">
            <input type="hidden" name="days" value={days} />
            <SearchInput value={q} placeholder={m.searchPlaceholder} />
            <Select name="source" value={source} label={m.filters.source} allLabel={c.all} options={SOURCES.map((s) => ({ value: s, label: sourceLabel[s] }))} />
            <Select name="status" value={status} label={m.filters.status} allLabel={c.all} options={STATUSES.map((s) => ({ value: s, label: m.status[s] }))} />
            <FilterButtons submit={c.filter} clearHref="/admin/errors" clear={c.clear} />
          </form>

          {rows.length === 0 ? (
            <Note>{m.empty}</Note>
          ) : (
            <>
              <Table
                empty={null}
                head={<><Th>{m.th.when}</Th><Th>{m.th.source}</Th><Th>{m.th.message}</Th><Th>{m.th.route}</Th><Th>{m.th.user}</Th><Th>{m.th.state}</Th></>}
              >
                {rows.map((r) => (
                  <tr key={r.id}>
                    <Td nowrap className="text-ink-soft">{fmtDateTime(r.created_at, locale)}</Td>
                    <Td nowrap><Pill tone={r.level === "warn" ? "warn" : "neutral"}>{sourceLabel[r.source] ?? r.source}</Pill></Td>
                    <Td className="max-w-[420px]">
                      <span className="block truncate text-[13px] font-semibold" title={r.message}>{r.message}</span>
                      <span className="mt-0.5 block truncate font-mono text-[11px] text-ink-faint" title={r.stack ?? m.noStack}>
                        {r.digest ? `${r.digest} · ` : ""}{(r.stack ?? "").split("\n")[1]?.trim() || (r.stack ? "" : m.noStack)}
                      </span>
                    </Td>
                    <Td nowrap className="font-mono text-[11.5px] text-ink-faint">{r.route ?? c.none}</Td>
                    <Td>{r.user_id ? <UserCell id={r.user_id} name={r.full_name} username={r.username} /> : <span className="text-ink-faint">{c.anonymous}</span>}</Td>
                    <Td nowrap>
                      {r.resolved_at ? (
                        <Pill tone="accent">{m.resolved}</Pill>
                      ) : (
                        <ConfirmAction label={m.resolve} title={m.resolveTitle} body={m.resolveBody} tone="neutral" action={resolveAppError.bind(null, r.id, false)} />
                      )}
                    </Td>
                  </tr>
                ))}
              </Table>
              <Pager
                page={Math.min(page, pg.pages)}
                pages={pg.pages}
                first={pg.first}
                last={pg.last}
                total={total}
                href={(p) => listHref("/admin/errors", current, { page: p })}
                labels={{ showing: c.showing, previous: c.previous, next: c.next }}
              />
            </>
          )}
        </Section>
      </div>
    </div>
  );
}
