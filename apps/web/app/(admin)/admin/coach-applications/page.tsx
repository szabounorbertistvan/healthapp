import Link from "next/link";
import { requireAdmin } from "@/lib/admin/guard";
import { listHref, oneOf, pageOf, paging, str, type Search } from "@/lib/admin/params";
import { supabaseServer } from "@/lib/supabase/server";
import { getI18n } from "@/lib/i18n/server";
import { fill } from "@/lib/i18n";
import { applicationState, type ReviewDecision } from "@/lib/coach-application";
import type { CoachProfileStatus } from "@/lib/coach-profile";
import { AdminHeader, FilterButtons, Note, Pager, Pill, Section, Select, Table, Td, Th, fmtDate } from "@/components/admin/ui";

const STATES = ["pending", "more_info", "rejected", "approved", "legacy", "all"] as const;
const SIZE = 50;

type Row = {
  id: string; slug: string; status: CoachProfileStatus; review_decision: ReviewDecision | null;
  submitted_at: string | null; reviewed_at: string | null; name: string | null; username: string | null; legacy: boolean;
  identity_documents: number; qualification_documents: number; specializations: string[];
};

export const dynamic = "force-dynamic";

/**
 * Admin · coach applications (admin_coach_applications, 20261118100000). The
 * queue every coach passes before going public: waiting ones oldest first,
 * then the other outcomes, filterable by state and submission date. Each row
 * opens /admin/coaches/[id], where the evidence is reviewed and decided on.
 * Admin-only twice over: the layout's guard here, admin_assert() in the RPC.
 */
export default async function AdminCoachApplicationsPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireAdmin();
  const { t, locale } = await getI18n();
  const m = t.admin.coaches.application;
  const c = t.admin.common;
  const params = await searchParams;
  const state = oneOf(params, "state", STATES) ?? "pending";
  const rawSince = str(params, "since");
  const since = rawSince && /^\d{4}-\d{2}-\d{2}$/.test(rawSince) && !Number.isNaN(Date.parse(rawSince)) ? rawSince : null;
  const page = pageOf(params);

  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("admin_coach_applications", {
    p_state: state, p_since: since, p_limit: SIZE, p_offset: (page - 1) * SIZE,
  });
  const result = (data ?? { total: 0, items: [] }) as { total: number; items: Row[] };
  const { pages, first, last } = paging(result.total, page, SIZE);
  const current = { state: state === "pending" ? null : state, since };

  return (
    <div>
      <AdminHeader title={m.queueTitle} intro={m.queueIntro} />
      <Section title={m.states[state]}>
        <form action="/admin/coach-applications" method="GET" className="mb-4 flex flex-wrap items-end gap-2">
          <Select name="state" value={state} label={m.state} allLabel={m.states.pending}
            options={STATES.filter((s) => s !== "pending").map((s) => ({ value: s, label: m.states[s] }))} />
          <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            {m.since}
            <input type="date" name="since" defaultValue={since ?? ""}
              className="h-9 rounded-xl border border-line bg-surface px-2.5 text-[13px] font-medium normal-case tracking-normal text-ink outline-none focus:border-accent" />
          </label>
          <FilterButtons submit={c.filter} clearHref="/admin/coach-applications" clear={c.clear} />
        </form>

        {error ? <Note>{c.loadError}</Note> : result.items.length === 0 ? <Note>{m.empty}</Note> : (
          <>
            <Table empty={null} head={<><Th>{m.th.coach}</Th><Th>{m.th.disciplines}</Th><Th>{m.th.documents}</Th><Th>{m.th.state}</Th><Th>{m.th.submitted}</Th><Th>{m.th.reviewed}</Th><Th /></>}>
              {result.items.map((row) => {
                const s = applicationState(row.status, row.review_decision);
                return (
                  <tr key={row.id} className="align-top" data-testid="admin-application-row" data-status={row.status}>
                    <Td className="min-w-[180px]">
                      <span className="font-semibold">{row.name ?? row.username ?? c.none}</span>
                      <span className="block text-[12px] text-ink-faint">/coaches/{row.slug}</span>
                    </Td>
                    <Td className="max-w-[260px] text-ink-soft">{row.specializations.join(", ") || c.none}</Td>
                    <Td nowrap>{fill(m.docCount, { identity: row.identity_documents, qualification: row.qualification_documents })}</Td>
                    <Td nowrap>
                      <Pill tone={s === "pending_review" || s === "more_info_required" ? "warn" : s === "approved" ? "accent" : s === "rejected" || s === "revoked" || s === "suspended" ? "risk" : "neutral"}>
                        {t.coachProfile.application.states[s]}
                      </Pill>
                      {row.legacy ? <span className="mt-1 block"><Pill tone="warn">{m.legacy}</Pill></span> : null}
                    </Td>
                    <Td nowrap>{row.submitted_at ? fmtDate(row.submitted_at, locale) : c.none}</Td>
                    <Td nowrap>{row.reviewed_at ? fmtDate(row.reviewed_at, locale) : c.none}</Td>
                    <Td nowrap>
                      <Link href={`/admin/coaches/${row.id}`} className="font-semibold text-accent-ink hover:underline">{m.open} →</Link>
                    </Td>
                  </tr>
                );
              })}
            </Table>
            <Pager page={Math.min(page, pages)} pages={pages} first={first} last={last} total={result.total}
              href={(p) => listHref("/admin/coach-applications", current, { page: p })}
              labels={{ showing: c.showing, previous: c.previous, next: c.next }} />
          </>
        )}
      </Section>
    </div>
  );
}
