import Link from "next/link";
import { requireAdmin } from "@/lib/admin/guard";
import { getAdminExercises } from "@/lib/admin/data";
import { EXERCISE_OWNERS, EXERCISE_SOURCES, PAGE_SIZE, listHref, oneOf, pageOf, paging, searchOf, str, type Search } from "@/lib/admin/params";
import { getI18n } from "@/lib/i18n/server";
import { AdminHeader, FilterButtons, Kpi, KpiGrid, Note, Pager, Pill, SearchInput, Section, Select, Table, Td, Th, fmtDate, fmtNum } from "@/components/admin/ui";

/** Category / equipment / muscle values are free text in the library; only what already exists in the table is offered. */
function safeText(v: string | null, max = 60): string | null {
  return v && v.length <= max && /^[\w\s\-'/().,]+$/i.test(v) ? v : null;
}

// Admin · the exercise database, read-only. Inspecting only: there is no
// delete because logged_sets / program_exercises reference exercises without
// cascade, and the Romanian names are edited on /admin/exercises/translate.
export default async function AdminExercisesPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireAdmin();
  const { t, locale } = await getI18n();
  const m = t.admin.exercises;
  const c = t.admin.common;
  const params = await searchParams;
  const q = searchOf(params);
  const category = safeText(str(params, "category"));
  const equipment = safeText(str(params, "equipment"));
  const muscle = safeText(str(params, "muscle"));
  const source = oneOf(params, "source", EXERCISE_SOURCES);
  const owner = oneOf(params, "owner", EXERCISE_OWNERS);
  const page = pageOf(params);
  const current = { q, category, equipment, muscle, source, owner, page };
  const { stats, total, rows } = await getAdminExercises({ search: q, category, equipment, muscle, source, owner, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
  const pg = paging(total, page, PAGE_SIZE);
  const n = (v: number | null | undefined) => fmtNum(v, locale);
  const opts = (rec: Record<string, number>) => Object.keys(rec).filter((k) => k !== "none").sort().map((k) => ({ value: k, label: `${k} (${rec[k]})` }));
  const muscles = Array.from(new Set(rows.flatMap((r) => r.primary_muscles))).sort();

  return (
    <div>
      <AdminHeader title={m.title}>
        <Link href="/admin/exercises/translate" className="inline-flex h-9 items-center rounded-xl bg-accent px-4 text-[12.5px] font-bold text-accent-fg hover:opacity-90">{m.translate}</Link>
      </AdminHeader>
      <KpiGrid cols={6}>
        <Kpi label={m.stats.total} value={n(stats.total)} accent href="/admin/exercises" />
        <Kpi label={m.stats.system} value={n(stats.system)} href="/admin/exercises?owner=system" />
        <Kpi label={m.stats.custom} value={n(stats.custom)} href="/admin/exercises?owner=custom" />
        <Kpi label={m.stats.missingRo} value={n(stats.missing_ro)} warn={stats.missing_ro > 0} href="/admin/exercises/translate" />
        <Kpi label={m.stats.withImages} value={n(stats.with_images)} />
        <Kpi label={m.stats.inUse} value={n(stats.in_use)} />
      </KpiGrid>

      <Section title={`${n(total)} · ${c.total}`} className="mt-4" hint={m.deleteHint}>
        <form action="/admin/exercises" method="GET" className="mb-4 flex flex-wrap items-end gap-2">
          <SearchInput value={q} placeholder={m.searchPlaceholder} />
          <Select name="category" value={category} label={m.filters.category} allLabel={c.all} options={opts(stats.categories)} />
          <Select name="equipment" value={equipment} label={m.filters.equipment} allLabel={c.all} options={opts(stats.equipment)} />
          <Select name="muscle" value={muscle} label={m.filters.muscle} allLabel={c.all} options={(muscle ? Array.from(new Set([muscle, ...muscles])) : muscles).map((x) => ({ value: x, label: x }))} />
          <Select name="source" value={source} label={m.filters.source} allLabel={c.all} options={EXERCISE_SOURCES.map((s) => ({ value: s, label: s }))} />
          <Select name="owner" value={owner} label={m.filters.owner} allLabel={c.all} options={EXERCISE_OWNERS.map((o) => ({ value: o, label: m.owners[o] }))} />
          <FilterButtons submit={c.filter} clearHref="/admin/exercises" clear={c.clear} />
        </form>
        <Table empty={rows.length === 0 ? m.empty : null} head={<>
          <Th>{m.th.name}</Th><Th>{m.th.nameRo}</Th><Th>{m.th.category}</Th><Th>{m.th.level}</Th><Th>{m.th.equipment}</Th><Th>{m.th.muscles}</Th>
          <Th>{m.th.source}</Th><Th>{m.th.external}</Th><Th>{m.th.owner}</Th><Th className="text-right">{m.th.logs}</Th><Th className="text-right">{m.th.programs}</Th><Th>{m.th.created}</Th><Th>{m.th.updated}</Th>
        </>}>
          {rows.map((e) => (
            <tr key={e.id}>
              <Td className="font-semibold"><span title={e.id}>{e.name_en}</span>{e.image_count > 0 ? <span className="ml-1 text-[10px] text-ink-faint">📷{e.image_count}</span> : null}</Td>
              <Td>{e.name_ro ?? <span className="text-warn">{c.none}</span>}</Td>
              <Td nowrap className="text-ink-soft">{e.category ?? c.none}</Td>
              <Td nowrap className="text-ink-soft">{e.level ?? c.none}</Td>
              <Td nowrap className="text-ink-soft">{e.equipment ?? c.none}</Td>
              <Td className="text-ink-soft">{e.primary_muscles.join(", ") || c.none}</Td>
              <Td nowrap><Pill tone={e.source === "custom" ? "warn" : "neutral"}>{e.source}</Pill></Td>
              <Td nowrap className="font-mono text-[11px] text-ink-faint">{e.external_id ?? c.none}</Td>
              <Td nowrap>{e.owner_id ? <Link href={`/admin/users/${e.owner_id}`} className="hover:text-accent-ink">@{e.owner_username ?? e.owner_id.slice(0, 8)}</Link> : <span className="text-ink-faint">{m.library}</span>}</Td>
              <Td className="text-right tabular-nums">{n(e.logged_sets)}</Td>
              <Td className="text-right tabular-nums">{n(e.in_programs)}</Td>
              <Td nowrap className="text-ink-faint">{fmtDate(e.created_at, locale)}</Td>
              <Td nowrap className="text-ink-faint">{fmtDate(e.updated_at, locale)}</Td>
            </tr>
          ))}
        </Table>
        <Pager page={Math.min(page, pg.pages)} pages={pg.pages} first={pg.first} last={pg.last} total={total} href={(p) => listHref("/admin/exercises", current, { page: p })} labels={{ showing: c.showing, previous: c.previous, next: c.next }} />
        <Note>{m.deleteHint}</Note>
      </Section>
    </div>
  );
}
