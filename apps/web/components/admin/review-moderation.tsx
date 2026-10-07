import { fill } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import type { AdminReviewRow } from "@/lib/review-data";
import { hideReview, restoreReview } from "@/app/admin-coach-actions";
import { ConfirmAction } from "./confirm-action";
import { Note, Pill, Section, fmtDateTime } from "./ui";

/**
 * Review moderation in the admin panel (20261106100000): one coach's reviews
 * on /admin/coaches/[id], or every reported one on /admin/coaches. Hide
 * (reason required) and restore go through admin_set_review_status(), which
 * re-checks is_admin(), closes the review's open reports and audits. A
 * review the reviewer deleted is shown for the record, never restorable.
 */
export async function AdminReviewModeration({ rows, reported = false }: { rows: AdminReviewRow[]; reported?: boolean }) {
  const { t, locale } = await getI18n();
  const r = t.admin.coaches.reviews;
  return (
    <Section title={reported ? r.reported : r.title} hint={reported ? r.reportedHint : r.hint}>
      {rows.length === 0 ? (
        <Note>{reported ? r.noneReported : r.empty}</Note>
      ) : (
        <ul className="grid gap-2.5" data-testid={reported ? "admin-reported-reviews" : "admin-coach-reviews"}>
          {rows.map((row) => (
            <li key={row.id} className="rounded-2xl bg-bg p-4 text-[13.5px]" data-testid="admin-review" data-status={row.status}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-display font-bold">{"★".repeat(row.rating)}{"☆".repeat(5 - row.rating)}</span>
                <Pill tone={row.status === "published" ? "accent" : row.status === "hidden" ? "risk" : "neutral"}>{r.statuses[row.status]}</Pill>
                {row.open_reports > 0 ? <Pill tone="warn">{fill(r.reports, { n: row.open_reports })}</Pill> : null}
                <span className="text-ink-faint">
                  {reported ? `${fill(r.about, { name: row.coach_name })} · ` : ""}{fill(r.by, { name: row.reviewer_name })} · {fmtDateTime(row.created_at, locale)}
                </span>
              </div>
              {row.body ? <p className="mt-2 whitespace-pre-line text-ink-soft">{row.body}</p> : null}
              {row.coach_response ? <p className="mt-2 text-[12.5px] text-ink-faint">{fill(r.answer, { text: row.coach_response })}</p> : null}
              {row.status === "hidden" && row.moderation_reason ? (
                <p className="mt-2 text-[12.5px] text-risk">{fill(r.hiddenBecause, { reason: row.moderation_reason })}</p>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                {row.status === "published" ? (
                  <ConfirmAction label={r.hide} title={r.hideTitle} body={r.hideBody} withReason action={hideReview.bind(null, row.id)} />
                ) : row.status === "hidden" ? (
                  <ConfirmAction label={r.restore} title={r.restoreTitle} body={r.restoreBody} tone="accent"
                    action={restoreReview.bind(null, row.id) as (reason: string) => ReturnType<typeof restoreReview>} />
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
