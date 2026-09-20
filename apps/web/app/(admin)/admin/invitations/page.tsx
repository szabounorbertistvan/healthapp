import { requireAdmin } from "@/lib/admin/guard";
import { getAdminInvitations } from "@/lib/admin/data";
import { INVITATION_STATUSES, PAGE_SIZE, intOf, listHref, oneOf, pageOf, paging, searchOf, type Search } from "@/lib/admin/params";
import { getI18n } from "@/lib/i18n/server";
import { AdminHeader, FilterButtons, Kpi, KpiGrid, Note, Pager, Pill, SearchInput, Section, Select, Table, Td, Th, UserCell, fmtDateTime, fmtNum } from "@/components/admin/ui";
import { ConfirmAction } from "@/components/admin/confirm-action";
import { revokeInvitation } from "@/app/admin-actions";

// Admin · invitations. trainer_clients rows, labelled by the RPC: pending,
// expired, accepted, revoked (ended before anyone claimed it) or ended.
export default async function AdminInvitationsPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireAdmin();
  const { t, locale } = await getI18n();
  const m = t.admin.invitations;
  const c = t.admin.common;
  const params = await searchParams;
  const status = oneOf(params, "status", INVITATION_STATUSES);
  const q = searchOf(params);
  const days = intOf(params, "days", 1, 365);
  const page = pageOf(params);
  const current = { status, q, days, page };
  const { stats, total, rows } = await getAdminInvitations({ status, search: q, days, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
  const pg = paging(total, page, PAGE_SIZE);
  const n = (v: number | null | undefined) => fmtNum(v, locale);
  const tone = (s: string) => (s === "accepted" ? "accent" : s === "pending" ? "warn" : s === "expired" || s === "revoked" ? "risk" : "neutral") as "accent" | "warn" | "risk" | "neutral";

  return (
    <div>
      <AdminHeader title={m.title} intro={m.intro} />
      <Section title={c.total}>
        <KpiGrid cols={5}>
          <Kpi label={m.stats.total} value={n(stats.total)} accent />
          <Kpi label={m.stats.pending} value={n(stats.pending)} />
          <Kpi label={m.stats.accepted} value={n(stats.accepted)} />
          <Kpi label={m.stats.expired} value={n(stats.expired)} />
          <Kpi label={m.stats.rate} value={stats.acceptance_rate === null ? c.none : `${n(stats.acceptance_rate)}%`} />
          <Kpi label={m.stats.revoked} value={n(stats.revoked)} />
          <Kpi label={m.stats.ended} value={n(stats.ended)} />
          <Kpi label={m.stats.sent7d} value={n(stats.created_7d)} />
          <Kpi label={m.stats.sent30d} value={n(stats.created_30d)} />
          <Kpi label="rejected" value="—" unavailable={m.rejectedHint} />
        </KpiGrid>
      </Section>

      <Section title={`${n(total)} · ${c.total}`} className="mt-4" hint={m.codeHint}>
        <form action="/admin/invitations" method="GET" className="mb-4 flex flex-wrap items-end gap-2">
          <SearchInput value={q} placeholder={m.searchPlaceholder} />
          <Select name="status" value={status} label={m.filters.status} allLabel={c.all} options={INVITATION_STATUSES.map((s) => ({ value: s, label: m.statuses[s] }))} />
          <Select name="days" value={days ? String(days) : null} label={m.filters.days} allLabel={c.all} options={[7, 30, 90].map((d) => ({ value: String(d), label: c.days.replace("{n}", String(d)) }))} />
          <FilterButtons submit={c.filter} clearHref="/admin/invitations" clear={c.clear} />
        </form>
        <Table empty={rows.length === 0 ? m.empty : null} head={<>
          <Th>{m.th.coach}</Th><Th>{m.th.client}</Th><Th>{m.th.status}</Th><Th>{m.th.created}</Th><Th>{m.th.expires}</Th><Th>{m.th.accepted}</Th><Th>{m.th.id}</Th><Th></Th>
        </>}>
          {rows.map((r) => (
            <tr key={r.id}>
              <Td><UserCell id={r.coach_id} name={r.coach_name} username={r.coach_username} /></Td>
              <Td>{r.client_id ? <UserCell id={r.client_id} name={r.client_name} username={r.client_username} /> : <span className="text-ink-faint">{m.noRecipient}</span>}</Td>
              <Td nowrap><Pill tone={tone(r.status)}>{m.labels[r.status]}</Pill></Td>
              <Td nowrap className="text-ink-soft">{fmtDateTime(r.created_at, locale)}</Td>
              <Td nowrap className="text-ink-soft">{r.expires_at ? fmtDateTime(r.expires_at, locale) : c.none}</Td>
              <Td nowrap className="text-ink-soft">{r.started_at ? fmtDateTime(r.started_at, locale) : c.none}{r.ended_at ? <span className="text-ink-faint"> → {fmtDateTime(r.ended_at, locale)}</span> : null}</Td>
              <Td className="font-mono text-[11px] text-ink-faint" nowrap><span title={r.id}>{r.id.slice(0, 8)}…</span></Td>
              <Td nowrap>{r.status === "pending" ? <ConfirmAction label={m.revoke} title={m.revokeTitle} body={m.revokeBody} tone="neutral" action={revokeInvitation.bind(null, r.id)} /> : null}</Td>
            </tr>
          ))}
        </Table>
        <Pager page={Math.min(page, pg.pages)} pages={pg.pages} first={pg.first} last={pg.last} total={total} href={(p) => listHref("/admin/invitations", current, { page: p })} labels={{ showing: c.showing, previous: c.previous, next: c.next }} />
        <Note>{m.rejectedHint}</Note>
      </Section>
    </div>
  );
}
