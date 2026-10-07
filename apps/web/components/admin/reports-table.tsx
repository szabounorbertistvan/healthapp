import Link from "next/link";
import { fill } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import type { AdminReport } from "@/lib/admin/marketplace-data";
import { dismissReport, resolveReport } from "@/app/admin-report-actions";
import { ConfirmAction } from "./confirm-action";
import { Note, Pill, Table, Td, Th, fmtDateTime } from "./ui";

/**
 * Reports as the admin reads them (20261110110000): what was reported, why,
 * by whom (admins only), how many other open reports the same thing has,
 * and a way to the thing itself. Open ones offer Resolve / Dismiss, which
 * close every open report of that target.
 */
export async function ReportsTable({ rows }: { rows: AdminReport[] }) {
  const { t, locale } = await getI18n();
  const r = t.admin.reports;
  if (rows.length === 0) return <Note>{r.empty}</Note>;

  const link = (row: AdminReport) =>
    row.coach_profile_id ? { href: `/admin/coaches/${row.coach_profile_id}`, label: r.openCoach }
    : row.kind === "post" ? { href: `/admin/social/${row.target_id}`, label: r.openPost }
    : row.target_user_id ? { href: `/admin/users/${row.target_user_id}`, label: r.openUser }
    : null;

  return (
    <Table empty={null} head={<><Th>{r.th.what}</Th><Th>{r.th.reason}</Th><Th>{r.th.reporter}</Th><Th>{r.th.when}</Th><Th>{r.th.status}</Th><Th /></>}>
      {rows.map((row) => {
        const to = link(row);
        return (
          <tr key={row.id} className="align-top" data-testid="admin-report" data-kind={row.kind} data-status={row.status}>
            <Td className="min-w-[220px]">
              <span className="block text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{r.kinds[row.kind]}</span>
              <span className="font-semibold">{row.target_label || "—"}</span>
              {row.kind === "review" && row.review_rating ? (
                <span className="mt-1 block text-[12.5px] text-ink-soft">
                  {"★".repeat(row.review_rating)} {row.review_body ? `“${row.review_body.slice(0, 160)}”` : ""}
                </span>
              ) : null}
              {row.status === "open" && row.open_for_target > 1 ? (
                <span className="mt-1 block text-[12px] font-semibold text-warn">{fill(r.sameTarget, { n: row.open_for_target })}</span>
              ) : null}
            </Td>
            <Td className="max-w-[260px]">
              <span className="font-semibold">{(r.reasons as Record<string, string>)[row.reason] ?? row.reason}</span>
              {row.details ? <span className="mt-0.5 block text-[12.5px] text-ink-soft">{row.details}</span> : null}
            </Td>
            <Td nowrap>{row.reporter_name}</Td>
            <Td nowrap>{fmtDateTime(row.created_at, locale)}</Td>
            <Td nowrap>
              <Pill tone={row.status === "open" ? "warn" : row.status === "dismissed" ? "neutral" : "accent"}>{r.statuses[row.status]}</Pill>
              {row.resolved_at ? <span className="mt-1 block text-[11.5px] text-ink-faint">{fmtDateTime(row.resolved_at, locale)}</span> : null}
              {row.resolution_note ? <span className="mt-0.5 block max-w-[200px] whitespace-normal text-[11.5px] text-ink-faint">{row.resolution_note}</span> : null}
            </Td>
            <Td nowrap>
              <div className="flex flex-wrap gap-1.5">
                {to ? <Link href={to.href} className="inline-flex h-9 items-center rounded-xl bg-surface px-3 text-[12.5px] font-bold text-ink-soft hover:text-ink">{to.label}</Link> : null}
                {row.status === "open" ? (
                  <>
                    <ConfirmAction tone="accent" withReason label={r.resolve} title={r.resolveTitle} body={r.resolveBody}
                      action={resolveReport.bind(null, row.id)} />
                    <ConfirmAction tone="neutral" withReason label={r.dismiss} title={r.dismissTitle} body={r.dismissBody}
                      action={dismissReport.bind(null, row.id)} />
                  </>
                ) : null}
              </div>
            </Td>
          </tr>
        );
      })}
    </Table>
  );
}
