import Link from "next/link";
import { requireAdmin } from "@/lib/admin/guard";
import { getAdminDailySeries, getAdminSocialPosts } from "@/lib/admin/data";
import { PAGE_SIZE, POST_STATUSES, POST_TYPES, POST_VISIBILITIES, listHref, oneOf, pageOf, paging, searchOf, str, uuidOf, type Search } from "@/lib/admin/params";
import { getI18n } from "@/lib/i18n/server";
import { AdminHeader, Breakdown, FilterButtons, Kpi, KpiGrid, Pager, Pill, SearchInput, Section, Select, Table, Td, Th, UserCell, fmtDateTime, fmtNum } from "@/components/admin/ui";
import { DailyBars } from "@/components/admin/charts";
import { ConfirmAction } from "@/components/admin/confirm-action";
import { deletePostAsAdmin } from "@/app/admin-actions";

// Admin · social overview and post list. Removal is the existing soft delete.
export default async function AdminSocialPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireAdmin();
  const { t, locale } = await getI18n();
  const m = t.admin.social;
  const c = t.admin.common;
  const params = await searchParams;
  const type = oneOf(params, "type", POST_TYPES);
  const visibility = oneOf(params, "visibility", POST_VISIBILITIES);
  const status = oneOf(params, "status", POST_STATUSES);
  const author = uuidOf(str(params, "author"));
  const q = searchOf(params);
  const page = pageOf(params);
  const current = { type, visibility, status, author, q, page };
  const [{ stats, total, rows }, series] = await Promise.all([
    getAdminSocialPosts({ type, visibility, status, search: q, author, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
    getAdminDailySeries(30),
  ]);
  const pg = paging(total, page, PAGE_SIZE);
  const n = (v: number | null | undefined) => fmtNum(v, locale);

  return (
    <div>
      <AdminHeader title={m.title} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Section title={c.total}>
          <KpiGrid cols={5}>
            <Kpi label={m.stats.posts} value={n(stats.posts)} accent sub={`${n(stats.posts_7d)} · ${c.last7}`} />
            <Kpi label={m.stats.comments} value={n(stats.comments)} sub={`${n(stats.comments_7d)} · ${c.last7}`} />
            <Kpi label={m.stats.kudos} value={n(stats.kudos)} sub={`${n(stats.kudos_7d)} · ${c.last7}`} />
            <Kpi label={m.stats.follows} value={n(stats.follows)} sub={`${n(stats.follows_7d)} · ${c.last7}`} />
            <Kpi label={m.stats.active7d} value={n(stats.active_users_7d)} />
            <Kpi label={m.stats.deleted} value={n(stats.posts_deleted)} />
          </KpiGrid>
          <div className="mt-3"><DailyBars title={m.chart} points={series.map((p) => ({ day: p.day, value: Number(p.posts) }))} locale={locale} accent /></div>
        </Section>
        <div className="space-y-4">
          <Section title={m.byType}><Breakdown data={stats.by_type} labels={m.types} locale={locale} /></Section>
          <Section title={m.byVisibility}><Breakdown data={stats.by_visibility} labels={m.visibilities} locale={locale} /></Section>
          <Section title={m.topAuthors}>
            <ul className="space-y-1.5">
              {stats.top_authors.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2 text-[12.5px]">
                  <UserCell id={a.id} name={a.full_name} username={a.username} />
                  <span className="tabular-nums text-ink-soft">{n(a.posts)}</span>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      </div>

      <Section title={`${n(total)} · ${c.total}`} className="mt-4">
        <form action="/admin/social" method="GET" className="mb-4 flex flex-wrap items-end gap-2">
          <SearchInput value={q} placeholder={m.searchPlaceholder} />
          {author ? <input type="hidden" name="author" value={author} /> : null}
          <Select name="type" value={type} label={m.filters.type} allLabel={c.all} options={POST_TYPES.map((v) => ({ value: v, label: m.types[v] }))} />
          <Select name="visibility" value={visibility} label={m.filters.visibility} allLabel={c.all} options={POST_VISIBILITIES.map((v) => ({ value: v, label: m.visibilities[v] }))} />
          <Select name="status" value={status} label={m.filters.status} allLabel={c.all} options={POST_STATUSES.map((v) => ({ value: v, label: m.statuses[v] }))} />
          <FilterButtons submit={c.filter} clearHref="/admin/social" clear={c.clear} />
        </form>
        <Table empty={rows.length === 0 ? m.empty : null} head={<>
          <Th>{m.th.author}</Th><Th>{m.th.type}</Th><Th>{m.th.text}</Th><Th>{m.th.created}</Th><Th>{m.th.visibility}</Th><Th className="text-right">{m.th.comments}</Th><Th className="text-right">{m.th.kudos}</Th><Th>{m.th.status}</Th><Th></Th>
        </>}>
          {rows.map((p) => (
            <tr key={p.id} className={p.deleted_at ? "opacity-60" : ""}>
              <Td><UserCell id={p.user_id} name={p.full_name} username={p.username} avatar={p.avatar_url} /></Td>
              <Td nowrap><Pill>{m.types[p.type as keyof typeof m.types] ?? p.type}</Pill></Td>
              <Td className="max-w-[360px]"><Link href={`/admin/social/${p.id}`} className="line-clamp-2 hover:text-accent-ink">{p.text || <span className="text-ink-faint">{typeof p.payload?.name === "string" ? p.payload.name : c.none}</span>}</Link></Td>
              <Td nowrap className="text-ink-soft">{fmtDateTime(p.created_at, locale)}</Td>
              <Td nowrap className="text-ink-soft">{m.visibilities[p.visibility as keyof typeof m.visibilities] ?? p.visibility}</Td>
              <Td className="text-right tabular-nums">{n(p.comments)}</Td>
              <Td className="text-right tabular-nums">{n(p.kudos)}</Td>
              <Td nowrap>{p.deleted_at ? <Pill tone="risk">{m.statuses.deleted}</Pill> : <Pill tone="accent">{m.statuses.live}</Pill>}</Td>
              <Td nowrap>{!p.deleted_at ? <ConfirmAction label={m.delete} title={m.deleteTitle} body={m.deleteBody} tone="risk" withReason action={deletePostAsAdmin.bind(null, p.id)} /> : null}</Td>
            </tr>
          ))}
        </Table>
        <Pager page={Math.min(page, pg.pages)} pages={pg.pages} first={pg.first} last={pg.last} total={total} href={(p) => listHref("/admin/social", current, { page: p })} labels={{ showing: c.showing, previous: c.previous, next: c.next }} />
      </Section>
    </div>
  );
}
