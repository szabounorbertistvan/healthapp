import Link from "next/link";
import { requireAdmin } from "@/lib/admin/guard";
import { getAdminUsers } from "@/lib/admin/data";
import {
  PAGE_SIZE, USER_COACH, USER_ROLES, USER_SORTS, USER_STATUSES, intOf, listHref, oneOf, pageOf, paging, searchOf, type Search,
} from "@/lib/admin/params";
import { getI18n } from "@/lib/i18n/server";
import { fill } from "@/lib/i18n";
import { TIER_LABEL } from "@/lib/entitlements";
import { AdminHeader, FilterButtons, Pager, Pill, SearchInput, Section, Select, Table, Td, Th, UserCell, fmtDate, fmtDateTime, fmtNum } from "@/components/admin/ui";

// Admin · user directory. Every filter, the sort and the page live in the
// URL; the RPC validates them again and returns one page plus the total.
export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireAdmin();
  const { t, locale } = await getI18n();
  const m = t.admin.users;
  const c = t.admin.common;
  const params = await searchParams;

  const q = searchOf(params);
  const role = oneOf(params, "role", USER_ROLES);
  const status = oneOf(params, "status", USER_STATUSES);
  const coach = oneOf(params, "coach", USER_COACH);
  const created = intOf(params, "created", 1, 365);
  const active = intOf(params, "active", 1, 365);
  const sort = oneOf(params, "sort", USER_SORTS) ?? "newest";
  const page = pageOf(params);
  const current = { q, role, status, coach, created, active, sort: sort === "newest" ? null : sort, page };

  const { total, rows } = await getAdminUsers({
    search: q, role, status, coach, createdDays: created, activeDays: active, sort,
    limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE,
  });
  const pg = paging(total, page, PAGE_SIZE);
  const href = (next: Record<string, string | number | null>) => listHref("/admin/users", current, next);
  const opt = (values: readonly string[], labels: Record<string, string>) => values.map((v) => ({ value: v, label: labels[v] ?? v }));

  return (
    <div>
      <AdminHeader title={m.title} />
      <Section title={`${fmtNum(total, locale)} · ${c.total}`}>
        <form action="/admin/users" method="GET" className="mb-4 flex flex-wrap items-end gap-2">
          <SearchInput value={q} placeholder={m.searchPlaceholder} />
          <Select name="role" value={role} label={m.filters.role} allLabel={c.all} options={opt(USER_ROLES, c.roles)} />
          <Select name="status" value={status} label={m.filters.status} allLabel={c.all} options={opt(USER_STATUSES, m.statuses)} />
          <Select name="coach" value={coach} label={m.filters.coach} allLabel={c.all} options={opt(USER_COACH, m.coachFilter)} />
          <Select name="created" value={created ? String(created) : null} label={m.filters.created} allLabel={c.all} options={opt(Object.keys(m.createdOptions), m.createdOptions)} />
          <Select name="active" value={active ? String(active) : null} label={m.filters.active} allLabel={c.all} options={opt(Object.keys(m.activeOptions), m.activeOptions)} />
          <Select name="sort" value={sort} label={m.filters.sort} allLabel={m.sorts.newest} options={opt(USER_SORTS.filter((s) => s !== "newest"), m.sorts)} />
          <FilterButtons submit={c.filter} clearHref="/admin/users" clear={c.clear} />
        </form>

        <Table
          empty={rows.length === 0 ? m.noResults : null}
          head={<>
            <Th>{m.th.user}</Th><Th>{m.th.role}</Th><Th>{m.th.status}</Th><Th>{m.th.coach}</Th>
            <Th className="text-right">{m.th.workouts}</Th><Th className="text-right">{m.th.sets}</Th><Th className="text-right">{m.th.streak}</Th><Th className="text-right">{m.th.load}</Th>
            <Th>{m.th.lastActive}</Th><Th>{m.th.lastLogin}</Th><Th>{m.th.created}</Th><Th>{m.th.timezone}</Th><Th>{m.th.tier}</Th><Th className="text-right">{m.th.push}</Th>
          </>}
        >
          {rows.map((u) => (
            <tr key={u.id} className={u.suspended_at ? "opacity-70" : ""}>
              <Td>
                <UserCell id={u.id} name={u.full_name} username={u.username} avatar={u.avatar_url}
                  sub={<span title={u.id}>{u.email ?? u.full_name ?? c.none}{u.provider !== "email" ? ` · ${fill(m.provider, { provider: u.provider })}` : ""}</span>} />
              </Td>
              <Td nowrap>
                <Pill tone={u.role === "admin" ? "accent" : "neutral"}>{c.roles[u.role as keyof typeof c.roles] ?? u.role}</Pill>
                {u.role !== "client" && u.clients > 0 ? <span className="ml-1.5 text-[11.5px] text-ink-faint">{fill(m.clientsCount, { n: u.clients })}</span> : null}
              </Td>
              <Td nowrap>
                {u.suspended_at ? <Pill tone="risk">{m.suspendedBadge}</Pill>
                  : u.deletion_requested_at ? <Pill tone="warn">{m.deletionBadge}</Pill>
                  : u.last_activity_at && Date.now() - new Date(u.last_activity_at).getTime() < 30 * 86400e3 ? <Pill tone="accent">{m.statuses.active}</Pill>
                  : <Pill>{m.statuses.inactive}</Pill>}
              </Td>
              <Td nowrap>{u.coach_id ? <Link href={`/admin/users/${u.coach_id}`} className="hover:text-accent-ink">@{u.coach_username ?? u.coach_name}</Link> : <span className="text-ink-faint">{c.none}</span>}</Td>
              <Td className="text-right tabular-nums">{fmtNum(u.workouts, locale)}</Td>
              <Td className="text-right tabular-nums">{fmtNum(u.sets, locale)}</Td>
              <Td className="text-right tabular-nums">{u.streak > 0 ? u.streak : <span className="text-ink-faint">0</span>}</Td>
              <Td className="text-right tabular-nums">{fmtNum(u.load_7d, locale)}</Td>
              <Td nowrap className="text-ink-soft">{u.last_activity_at ? fmtDateTime(u.last_activity_at, locale) : <span className="text-ink-faint">{c.never}</span>}</Td>
              <Td nowrap className="text-ink-soft">{u.last_sign_in_at ? fmtDateTime(u.last_sign_in_at, locale) : <span className="text-ink-faint">{c.never}</span>}</Td>
              <Td nowrap className="text-ink-soft">{fmtDate(u.created_at, locale)}</Td>
              <Td nowrap className="text-ink-faint">{u.timezone}</Td>
              <Td nowrap>{TIER_LABEL[u.tier as keyof typeof TIER_LABEL] ?? u.tier}</Td>
              <Td className="text-right tabular-nums">{u.push_subscriptions > 0 ? u.push_subscriptions : <span className="text-ink-faint">0</span>}</Td>
            </tr>
          ))}
        </Table>
        <Pager page={pg.pages < page ? pg.pages : page} pages={pg.pages} first={pg.first} last={pg.last} total={total} href={(p) => href({ page: p })} labels={{ showing: c.showing, previous: c.previous, next: c.next }} />
      </Section>
    </div>
  );
}
