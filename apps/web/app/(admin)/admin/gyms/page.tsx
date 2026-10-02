import { requireAdmin } from "@/lib/admin/guard";
import { PAGE_SIZE, listHref, oneOf, pageOf, paging, searchOf, type Search } from "@/lib/admin/params";
import { supabaseServer } from "@/lib/supabase/server";
import Link from "next/link";
import { approveGym, deleteGym } from "@/app/admin-gym-actions";
import { gymMapHref } from "@/lib/gym-map";
import { getI18n } from "@/lib/i18n/server";
import { fill } from "@/lib/i18n";
import { ConfirmAction } from "@/components/admin/confirm-action";
import { AdminGymApprove, AdminGymEdit, AdminGymForm } from "@/components/admin/gym-form";
import {
  AdminHeader, FilterButtons, Kpi, KpiGrid, Note, Pager, Pill, SearchInput, Section, Select, Table, Td, Th, fmtDate, fmtNum,
} from "@/components/admin/ui";

const STATUSES = ["active", "pending"] as const;

type Row = {
  id: string;
  name: string;
  city: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  maps_url: string | null;
  status: "active" | "pending";
  created_at: string;
  suggested_by: string | null;
  members: number;
  coaches: { id: string; name: string; slug: string; status: string }[];
};
type Payload = {
  stats: { active: number; pending: number; members: number; coaches: number; requests: number };
  total: number;
  rows: Row[];
};

export const dynamic = "force-dynamic";

/**
 * Admin · gyms (20261023100000). Suggestions first, then every gym by city.
 * An admin adds a gym here (a Google Maps link can prefill it) and approves or
 * rejects what users suggested. Which coaches work at a gym comes from their
 * Coach Discovery profiles (coach_locations.gym_id), moderated with the profile.
 */
export default async function AdminGymsPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireAdmin();
  const { t, locale } = await getI18n();
  const m = t.gyms.admin;
  const c = t.admin.common;
  const params = await searchParams;
  const status = oneOf(params, "status", STATUSES);
  const q = searchOf(params);
  const page = pageOf(params);
  const current = { status, q, page };
  const n = (v: number | null | undefined) => fmtNum(v, locale);
  const href = (patch: Record<string, string | number | null>) => listHref("/admin/gyms", current, { page: 1, ...patch });

  const supabase = await supabaseServer();
  const { data } = await supabase.rpc("admin_gyms", {
    p_status: status, p_search: q, p_limit: PAGE_SIZE, p_offset: (page - 1) * PAGE_SIZE,
  });
  const payload = (data ?? { stats: { active: 0, pending: 0, members: 0, coaches: 0, requests: 0 }, total: 0, rows: [] }) as Payload;
  const { stats, total, rows } = payload;
  const pg = paging(total, page, PAGE_SIZE);

  return (
    <div>
      <AdminHeader title={m.title} intro={m.intro} />

      <Section title={m.title}>
        <KpiGrid cols={5}>
          <Kpi label={m.active} value={n(stats.active)} accent href={href({ status: "active" })} />
          <Kpi label={m.pending} value={n(stats.pending)} warn={stats.pending > 0} href={href({ status: "pending" })} />
          <Kpi label={m.members} value={n(stats.members)} />
          <Kpi label={m.coaches} value={n(stats.coaches)} />
          <Kpi label={m.requests} value={n(stats.requests)} />
        </KpiGrid>
      </Section>

      <div className="mt-4">
        <Section title={m.add}>
          <div className="max-w-2xl">
            <AdminGymForm />
          </div>
        </Section>
      </div>

      <div className="mt-4">
        <Section title={`${n(total)} · ${m.title}`}>
          <form action="/admin/gyms" method="GET" className="mb-4 flex flex-wrap items-end gap-2">
            <SearchInput value={q} placeholder={m.searchPlaceholder} />
            <Select name="status" value={status} label={m.status} allLabel={c.all} options={STATUSES.map((s) => ({ value: s, label: m.statuses[s] }))} />
            <FilterButtons submit={c.filter} clearHref="/admin/gyms" clear={c.clear} />
          </form>

          {rows.length === 0 ? (
            <Note>{m.empty}</Note>
          ) : (
            <>
              <Table empty={null} head={<><Th>{m.gym}</Th><Th>{m.city}</Th><Th>{m.members}</Th><Th>{m.coaches}</Th><Th>{m.status}</Th><Th>{m.actions}</Th></>}>
                {rows.map((g) => (
                  <tr key={g.id} className="align-top">
                    <Td className="min-w-[220px]">
                      <a href={gymMapHref(g)} target="_blank" rel="noopener noreferrer" className="font-semibold hover:underline">{g.name} ↗</a>
                      {g.address ? <span className="block text-[12px] text-ink-faint">{g.address}</span> : null}
                      <span className="block text-[11.5px] text-ink-faint">
                        {fmtDate(g.created_at, locale)}
                        {g.suggested_by ? ` · ${fill(m.suggestedBy, { name: g.suggested_by })}` : null}
                        {g.lat != null ? ` · ${g.lat.toFixed(4)}, ${g.lng?.toFixed(4)}` : null}
                      </span>
                    </Td>
                    <Td nowrap>{g.city}</Td>
                    <Td nowrap className="tabular-nums">{n(g.members)}</Td>
                    <Td>
                      {g.coaches.length === 0 ? <span className="text-ink-faint">{c.none}</span> : (
                        <ul className="grid gap-1">
                          {g.coaches.map((coach) => (
                            <li key={coach.id} className="flex items-center gap-2">
                              {/* The claim is reviewed with the coach profile, so moderation lives there. */}
                              {coach.status === "published" ? (
                                <Link href={`/coaches/${coach.slug}`} className="text-[13px] hover:underline">{coach.name}</Link>
                              ) : (
                                <span className="text-[13px] text-ink-faint">{coach.name} · {coach.status}</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </Td>
                    <Td nowrap><Pill tone={g.status === "pending" ? "warn" : "accent"}>{m.statuses[g.status]}</Pill></Td>
                    <Td>
                      <div className="flex flex-wrap items-start gap-2">
                        {g.status === "pending" ? <AdminGymApprove action={approveGym.bind(null, g.id)} label={m.approve} /> : null}
                        <AdminGymEdit gym={g} label={m.edit} />
                        <ConfirmAction
                          label={g.status === "pending" ? m.reject : m.delete}
                          title={fill(g.status === "pending" ? m.rejectTitle : m.deleteTitle, { name: g.name })}
                          body={g.status === "pending" ? m.rejectBody : m.deleteBody}
                          action={deleteGym.bind(null, g.id)}
                        />
                      </div>
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
                href={(p) => listHref("/admin/gyms", current, { page: p })}
                labels={{ showing: c.showing, previous: c.previous, next: c.next }}
              />
            </>
          )}
        </Section>
      </div>
    </div>
  );
}
