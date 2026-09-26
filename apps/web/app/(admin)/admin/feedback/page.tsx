import { requireAdmin } from "@/lib/admin/guard";
import { getAdminFeedback } from "@/lib/admin/data";
import { DAY_WINDOWS, PAGE_SIZE, daysOf, listHref, oneOf, pageOf, paging, searchOf, type Search } from "@/lib/admin/params";
import { getI18n } from "@/lib/i18n/server";
import { fill } from "@/lib/i18n";
import { FeedbackStatus } from "@/components/admin/feedback-status";
import {
  AdminHeader, DaysPicker, FilterButtons, Kpi, KpiGrid, Note, Pager, Pill, SearchInput, Section,
  Select, Table, Td, Th, UserCell, fmtDateTime, fmtNum,
} from "@/components/admin/ui";

const KINDS = ["bug", "idea", "other"] as const;
const STATUSES = ["new", "seen", "done"] as const;

export const dynamic = "force-dynamic";

/**
 * Admin · feedback. What people sent from the "Send feedback" dialog in both
 * shells (components/feedback.tsx), newest first, with the screen they were
 * on. Triage is new → seen → done; nothing is ever deleted.
 */
export default async function AdminFeedbackPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireAdmin();
  const { t, locale } = await getI18n();
  const m = t.admin.feedback;
  const c = t.admin.common;
  const params = await searchParams;
  const days = daysOf(params);
  const kind = oneOf(params, "kind", KINDS);
  const status = oneOf(params, "status", STATUSES);
  const q = searchOf(params);
  const page = pageOf(params);
  const current = { days, kind, status, q, page };
  const n = (v: number | null | undefined) => fmtNum(v, locale);
  const href = (patch: Record<string, string | number | null>) => listHref("/admin/feedback", current, { page: 1, ...patch });

  const { stats, total, rows } = await getAdminFeedback({
    days, kind, status, search: q, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE,
  });
  const pg = paging(total, page, PAGE_SIZE);
  const kindTone = { bug: "risk", idea: "accent", other: "neutral" } as const;
  const statusTone = { new: "warn", seen: "neutral", done: "accent" } as const;

  return (
    <div>
      <AdminHeader title={m.title} intro={m.intro}>
        <DaysPicker days={days} options={DAY_WINDOWS} href={(d) => href({ days: d })} label={(d) => fill(c.days, { n: d })} />
      </AdminHeader>

      <Section title={m.title}>
        <KpiGrid cols={6}>
          <Kpi label={m.window} value={n(stats.window)} accent href={href({ kind: null, status: null })} />
          <Kpi label={m.new} value={n(stats.new)} warn={stats.new > 0} href={href({ status: "new" })} />
          <Kpi label={m.seen} value={n(stats.seen)} href={href({ status: "seen" })} />
          <Kpi label={m.done} value={n(stats.done)} href={href({ status: "done" })} />
          <Kpi label={m.bug} value={n(stats.bug)} href={href({ kind: "bug" })} />
          <Kpi label={m.idea} value={n(stats.idea)} href={href({ kind: "idea" })} />
          <Kpi label={m.other} value={n(stats.other)} href={href({ kind: "other" })} />
          <Kpi label={m.users} value={n(stats.users)} />
          <Kpi label={m.totalEver} value={n(stats.total)} />
          <Kpi label={m.lastAt} value={<span className="text-[15px]">{fmtDateTime(stats.last_at, locale)}</span>} />
        </KpiGrid>
      </Section>

      <div className="mt-4">
        <Section title={`${n(total)} · ${m.recent}`}>
          <form action="/admin/feedback" method="GET" className="mb-4 flex flex-wrap items-end gap-2">
            <input type="hidden" name="days" value={days} />
            <SearchInput value={q} placeholder={m.searchPlaceholder} />
            <Select name="kind" value={kind} label={m.filters.kind} allLabel={c.all} options={KINDS.map((k) => ({ value: k, label: m.kinds[k] }))} />
            <Select name="status" value={status} label={m.filters.status} allLabel={c.all} options={STATUSES.map((s) => ({ value: s, label: m.status[s] }))} />
            <FilterButtons submit={c.filter} clearHref="/admin/feedback" clear={c.clear} />
          </form>

          {rows.length === 0 ? (
            <Note>{m.empty}</Note>
          ) : (
            <>
              <Table
                empty={null}
                head={<><Th>{m.th.when}</Th><Th>{m.th.kind}</Th><Th>{m.th.message}</Th><Th>{m.th.route}</Th><Th>{m.th.user}</Th><Th>{m.th.state}</Th><Th /></>}
              >
                {rows.map((r) => (
                  <tr key={r.id} className="align-top">
                    <Td nowrap className="text-ink-soft">{fmtDateTime(r.created_at, locale)}</Td>
                    <Td nowrap><Pill tone={kindTone[r.kind]}>{m.kinds[r.kind]}</Pill></Td>
                    <Td className="min-w-[280px] max-w-[560px]">
                      <span className="block whitespace-pre-wrap break-words text-[13px] leading-relaxed">{r.message}</span>
                      {r.user_agent ? <span className="mt-1 block truncate text-[11px] text-ink-faint" title={r.user_agent}>{r.user_agent}</span> : null}
                    </Td>
                    <Td nowrap className="font-mono text-[11.5px] text-ink-faint">{r.route ?? c.none}</Td>
                    <Td>{r.user_id ? <UserCell id={r.user_id} name={r.full_name} username={r.username} sub={r.role ?? undefined} /> : <span className="text-ink-faint">{c.none}</span>}</Td>
                    <Td nowrap><Pill tone={statusTone[r.status]}>{m.status[r.status]}</Pill></Td>
                    <Td nowrap><FeedbackStatus id={r.id} status={r.status} labels={{ markSeen: m.markSeen, markDone: m.markDone, reopen: m.reopen }} /></Td>
                  </tr>
                ))}
              </Table>
              <Pager
                page={Math.min(page, pg.pages)}
                pages={pg.pages}
                first={pg.first}
                last={pg.last}
                total={total}
                href={(p) => listHref("/admin/feedback", current, { page: p })}
                labels={{ showing: c.showing, previous: c.previous, next: c.next }}
              />
            </>
          )}
        </Section>
      </div>
    </div>
  );
}
