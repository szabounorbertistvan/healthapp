import Link from "next/link";
import { requireAdmin } from "@/lib/admin/guard";
import { getAdminAuditLog } from "@/lib/admin/data";
import { AUDIT_ACTIONS, AUDIT_PAGE_SIZE, listHref, oneOf, pageOf, paging, searchOf, str, uuidOf, type Search } from "@/lib/admin/params";
import { getI18n } from "@/lib/i18n/server";
import { AdminHeader, FilterButtons, Pager, Pill, SearchInput, Section, Select, Table, Td, Th, fmtDateTime, fmtNum } from "@/components/admin/ui";

const ENTITY_TYPES = ["user", "invitation", "session", "set", "program", "exercise", "challenge", "post", "comment", "push_subscription", "email"] as const;

/** Compact, safe rendering of the metadata column: a few known keys, never a JSON dump of a payload. */
function details(meta: Record<string, unknown>): string {
  const keys = ["exercise", "reps", "weight_kg", "provider", "email", "from", "to", "reason", "kind", "name", "type", "title", "status", "duration_min", "user_agent", "by_admin", "role", "changed"];
  const out: string[] = [];
  for (const k of keys) {
    const v = meta[k];
    if (v === undefined || v === null || v === "") continue;
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    out.push(`${k}: ${s.length > 80 ? s.slice(0, 77) + "…" : s}`);
  }
  return out.join(" · ");
}

function dateIso(v: string | null): string | null {
  return v && !Number.isNaN(Date.parse(v)) ? v : null;
}

// Admin · the audit log. Append-only stream; this page only reads it, with
// enumerated filters. The RPC clamps the page size and re-validates.
export default async function AdminActivityPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireAdmin();
  const { t, locale } = await getI18n();
  const m = t.admin.activity;
  const c = t.admin.common;
  const params = await searchParams;
  const action = oneOf(params, "action", AUDIT_ACTIONS);
  const entity = oneOf(params, "entity", ENTITY_TYPES);
  const actor = uuidOf(str(params, "actor"));
  const target = uuidOf(str(params, "target"));
  const q = searchOf(params);
  const from = dateIso(str(params, "from"));
  const to = dateIso(str(params, "to"));
  const page = pageOf(params);
  const current = { action, entity, actor, target, q, from, to, page };

  const { total, rows } = await getAdminAuditLog({
    action, entityType: entity, actor, target, search: q,
    from, to: to ? new Date(new Date(to).getTime() + 86400e3).toISOString() : null,
    limit: AUDIT_PAGE_SIZE, offset: (page - 1) * AUDIT_PAGE_SIZE,
  });
  const pg = paging(total, page, AUDIT_PAGE_SIZE);
  const isAdminAction = (a: string) => ["ADMIN_ACTION", "USER_SUSPENDED", "USER_REACTIVATED", "TIER_CHANGED", "ROLE_CHANGED"].includes(a);

  return (
    <div>
      <AdminHeader title={m.title} intro={m.intro} />
      <Section title={`${fmtNum(total, locale)} · ${c.total}`}>
        <form action="/admin/activity" method="GET" className="mb-4 flex flex-wrap items-end gap-2">
          <SearchInput value={q} placeholder={m.searchPlaceholder} />
          <Select name="action" value={action} label={m.filters.action} allLabel={c.all} options={AUDIT_ACTIONS.map((a) => ({ value: a, label: m.actions[a] }))} />
          <Select name="entity" value={entity} label={m.filters.entity} allLabel={c.all} options={ENTITY_TYPES.map((e) => ({ value: e, label: e }))} />
          <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{m.filters.actor}
            <input name="actor" defaultValue={actor ?? ""} placeholder="uuid" className="h-9 w-40 rounded-xl border border-line bg-surface px-2.5 font-mono text-[12px] normal-case tracking-normal text-ink outline-none focus:border-accent" /></label>
          <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{m.filters.target}
            <input name="target" defaultValue={target ?? ""} placeholder="uuid" className="h-9 w-40 rounded-xl border border-line bg-surface px-2.5 font-mono text-[12px] normal-case tracking-normal text-ink outline-none focus:border-accent" /></label>
          <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{m.filters.from}
            <input type="date" name="from" defaultValue={from ?? ""} className="h-9 rounded-xl border border-line bg-surface px-2.5 text-[12.5px] normal-case tracking-normal text-ink outline-none focus:border-accent" /></label>
          <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{m.filters.to}
            <input type="date" name="to" defaultValue={to ?? ""} className="h-9 rounded-xl border border-line bg-surface px-2.5 text-[12.5px] normal-case tracking-normal text-ink outline-none focus:border-accent" /></label>
          <FilterButtons submit={c.filter} clearHref="/admin/activity" clear={c.clear} />
        </form>

        <Table empty={rows.length === 0 ? m.empty : null} head={<>
          <Th>{m.th.when}</Th><Th>{m.th.actor}</Th><Th>{m.th.action}</Th><Th>{m.th.target}</Th><Th>{m.th.entity}</Th><Th>{m.th.details}</Th><Th>{m.th.client}</Th>
        </>}>
          {rows.map((r) => (
            <tr key={r.id}>
              <Td nowrap className="text-ink-soft"><span title={`#${r.id}`}>{fmtDateTime(r.created_at, locale)}</span></Td>
              <Td nowrap>
                {r.actor_user_id ? (
                  <Link href={`/admin/users/${r.actor_user_id}`} className="hover:text-accent-ink">@{r.actor_username ?? r.actor_name ?? r.actor_user_id.slice(0, 8)}</Link>
                ) : <span className="text-ink-faint">{r.action === "LOGIN_FAILED" ? c.anonymous : c.system}</span>}
                {r.actor_role ? <span className="ml-1 text-[10.5px] uppercase tracking-wider text-ink-faint">{r.actor_role}</span> : null}
              </Td>
              <Td nowrap><Pill tone={isAdminAction(r.action) ? "warn" : r.action === "LOGIN_FAILED" ? "risk" : "neutral"}>{m.actions[r.action] ?? r.action}</Pill></Td>
              <Td nowrap>{r.target_user_id ? <Link href={`/admin/users/${r.target_user_id}`} className="hover:text-accent-ink">@{r.target_username ?? r.target_name ?? r.target_user_id.slice(0, 8)}</Link> : <span className="text-ink-faint">{c.none}</span>}</Td>
              <Td nowrap className="text-ink-faint">
                {r.entity_type}{r.entity_id ? <span className="ml-1 font-mono text-[11px]" title={r.entity_id}>{r.entity_id.length > 12 ? r.entity_id.slice(0, 8) + "…" : r.entity_id}</span> : null}
              </Td>
              <Td className="max-w-[360px] text-[12px] text-ink-soft"><span className="line-clamp-2" title={details(r.metadata)}>{details(r.metadata) || c.none}</span></Td>
              <Td className="max-w-[200px] text-[11px] text-ink-faint">
                <span className="block truncate font-mono">{r.ip ?? ""}</span>
                <span className="block truncate" title={r.user_agent ?? ""}>{r.user_agent ?? ""}</span>
              </Td>
            </tr>
          ))}
        </Table>
        <Pager page={Math.min(page, pg.pages)} pages={pg.pages} first={pg.first} last={pg.last} total={total} href={(p) => listHref("/admin/activity", current, { page: p })} labels={{ showing: c.showing, previous: c.previous, next: c.next }} />
      </Section>
    </div>
  );
}
