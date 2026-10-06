import Link from "next/link";
import { requireAdmin } from "@/lib/admin/guard";
import { oneOf, type Search } from "@/lib/admin/params";
import { supabaseServer } from "@/lib/supabase/server";
import { getI18n } from "@/lib/i18n/server";
import { COACH_PROFILE_STATUSES, type CoachProfileStatus, type CoachVerificationStatus } from "@/lib/coach-profile";
import {
  AdminHeader, FilterButtons, Kpi, KpiGrid, Note, Pill, Section, Select, Table, Td, Th, fmtDate, fmtNum,
} from "@/components/admin/ui";

type Row = {
  id: string;
  user_id: string;
  slug: string;
  display_name: string;
  headline: string | null;
  status: CoachProfileStatus;
  submitted_at: string | null;
  published_at: string | null;
  suspended_at: string | null;
  updated_at: string;
  verification_status: CoachVerificationStatus;
  verification_requested_at: string | null;
};

export const dynamic = "force-dynamic";

const TONE: Record<CoachProfileStatus, "neutral" | "accent" | "warn" | "risk"> = {
  draft: "neutral", pending_review: "warn", published: "accent", hidden: "neutral", suspended: "risk",
};

/**
 * Admin · coach profiles (Coach Discovery). The review queue — waiting for
 * review first, oldest submission first (admin_coach_profiles) — and every
 * other status a click away. Each row opens /admin/coaches/[id], where the
 * profile is previewed with the public page's own component and decided on.
 */
export default async function AdminCoachesPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireAdmin();
  const { t, locale } = await getI18n();
  const m = t.admin.coaches;
  const c = t.admin.common;
  const params = await searchParams;
  // no filter in the URL = the queue; "all" = everything
  const raw = typeof params.status === "string" ? params.status : null;
  // ?verification=pending: the verification requests, whatever the profile status (20261101100000)
  const verification = params.verification === "pending" ? "pending" : null;
  const status = raw === "all" || (verification && !raw) ? null : oneOf(params, "status", COACH_PROFILE_STATUSES) ?? "pending_review";
  const v = m.verification;
  const href = (s: string) => `/admin/coaches?status=${s}`;

  const supabase = await supabaseServer();
  const [{ data: rows }, { data: counts }] = await Promise.all([
    supabase.rpc("admin_coach_profiles", { p_status: status, p_verification: verification }),
    supabase.rpc("admin_coach_profile_counts"),
  ]);
  const list = (rows ?? []) as Row[];
  const n = (counts ?? {}) as Partial<Record<CoachProfileStatus | "verification_pending", number>>;

  return (
    <div>
      <AdminHeader title={m.title} intro={m.intro} />

      <Section title={m.title}>
        <KpiGrid cols={6}>
          {COACH_PROFILE_STATUSES.map((s) => (
            <Kpi key={s} label={m.statuses[s]} value={fmtNum(n[s] ?? 0, locale)} href={href(s)}
              warn={s === "pending_review" && (n[s] ?? 0) > 0} accent={s === "published"} />
          ))}
          <Kpi label={v.kpi} value={fmtNum(n.verification_pending ?? 0, locale)} href="/admin/coaches?verification=pending"
            warn={(n.verification_pending ?? 0) > 0} />
        </KpiGrid>
      </Section>

      <div className="mt-4">
        <Section title={verification ? v.kpi : status ? m.statuses[status] : c.all}>
          <form action="/admin/coaches" method="GET" className="mb-4 flex flex-wrap items-end gap-2">
            <Select name="status" value={status ?? "all"} label={m.status} allLabel={c.all}
              options={[{ value: "all", label: c.all }, ...COACH_PROFILE_STATUSES.map((s) => ({ value: s, label: m.statuses[s] }))]} />
            <FilterButtons submit={c.filter} clearHref="/admin/coaches" clear={c.clear} />
          </form>

          {list.length === 0 ? (
            <Note>{m.empty}</Note>
          ) : (
            <Table empty={null} head={<><Th>{m.th.coach}</Th><Th>{m.th.headline}</Th><Th>{m.th.status}</Th><Th>{v.column}</Th><Th>{m.th.submitted}</Th><Th>{m.th.updated}</Th><Th /></>}>
              {list.map((row) => (
                <tr key={row.id} className="align-top" data-testid="admin-coach-row" data-status={row.status}>
                  <Td className="min-w-[180px]">
                    <span className="font-semibold">{row.display_name}</span>
                    <span className="block text-[12px] text-ink-faint">/coaches/{row.slug}</span>
                  </Td>
                  <Td className="max-w-[320px] text-ink-soft">{row.headline ?? c.none}</Td>
                  <Td nowrap><Pill tone={TONE[row.status]}>{m.statuses[row.status]}</Pill></Td>
                  <Td nowrap>
                    <Pill tone={row.verification_status === "pending" ? "warn" : row.verification_status === "verified" ? "accent" : row.verification_status === "rejected" ? "risk" : "neutral"}>
                      {v.statuses[row.verification_status]}
                    </Pill>
                  </Td>
                  <Td nowrap>{row.submitted_at ? fmtDate(row.submitted_at, locale) : c.none}</Td>
                  <Td nowrap>{fmtDate(row.updated_at, locale)}</Td>
                  <Td nowrap>
                    <Link href={`/admin/coaches/${row.id}`} className="font-semibold text-accent-ink hover:underline">{m.review} →</Link>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Section>
      </div>
    </div>
  );
}
