import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin/guard";
import { uuidOf } from "@/lib/admin/params";
import { supabaseServer } from "@/lib/supabase/server";
import { fill } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import { summary } from "@/lib/coach-onboarding";
import type { CoachProfileMissing, CoachProfileStatus, CoachPublicProfile } from "@/lib/coach-profile";
import {
  approveCoachProfile, restoreCoachProfile, returnCoachProfileToDraft, suspendCoachProfile,
} from "@/app/admin-coach-actions";
import { ConfirmAction } from "@/components/admin/confirm-action";
import { AdminHeader, Note, Pill, Section, fmtDateTime } from "@/components/admin/ui";
import { CoachProfilePreview } from "@/components/coach-profile/preview";

type Review = CoachPublicProfile & {
  status: CoachProfileStatus;
  submitted_at: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  suspended_at: string | null;
  suspension_reason: string | null;
  updated_at: string;
  account_suspended: boolean;
  missing: CoachProfileMissing[];
};

export const dynamic = "force-dynamic";

/**
 * Admin · one coach profile (admin_coach_review, 20261029100000): the
 * decision panel, then the profile drawn by the public page's own component
 * (CoachProfilePreview) — what the admin approves is what the public sees.
 * The actions offered are exactly the transitions the database allows from
 * this status; the database re-checks every one.
 */
export default async function AdminCoachReviewPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id: raw } = await params;
  const id = uuidOf(raw);
  if (!id) notFound();
  const { t, locale } = await getI18n();
  const m = t.admin.coaches;
  const groups = t.coachProfile.publish.groups;

  const supabase = await supabaseServer();
  const { data } = await supabase.rpc("admin_coach_review", { p_profile: id });
  const review = data as Review | null;
  if (!review) notFound();

  const name = review.display_name;
  const open = summary(review.missing ?? []).filter((x) => !x.done).map((x) => groups[x.group]);
  const s = review.status;

  return (
    <div>
      <Link href="/admin/coaches" className="text-[13px] font-semibold text-ink-faint hover:text-ink">← {m.back}</Link>
      <AdminHeader title={name} intro={`/coaches/${review.slug}`}>
        <Pill tone={s === "pending_review" ? "warn" : s === "published" ? "accent" : s === "suspended" ? "risk" : "neutral"}>
          {m.statuses[s]}
        </Pill>
      </AdminHeader>

      <Section title={m.checklist}>
        <div className="grid gap-2 text-[13.5px]" data-testid="admin-coach-review" data-status={s}>
          <p className={open.length ? "text-warn" : "text-ink-soft"}>
            {open.length ? fill(m.missing, { list: open.join(", ") }) : m.complete}
          </p>
          {review.submitted_at ? <p className="text-ink-faint">{fill(m.submittedAt, { date: fmtDateTime(review.submitted_at, locale) })}</p> : null}
          {review.reviewed_at ? <p className="text-ink-faint">{fill(m.reviewedAt, { date: fmtDateTime(review.reviewed_at, locale) })}</p> : null}
          {review.review_note && s === "draft" ? <p className="text-ink-soft">{fill(m.reviewNote, { note: review.review_note })}</p> : null}
          {s === "suspended" && review.suspension_reason ? <p className="text-risk">{fill(m.suspension, { reason: review.suspension_reason })}</p> : null}
          {s === "hidden" ? <p className="text-ink-soft">{m.hiddenNote}</p> : null}
          {review.account_suspended ? <Note>{m.accountSuspended}</Note> : null}

          <div className="mt-2 flex flex-wrap gap-2">
            {s === "pending_review" ? (
              <>
                <ConfirmAction tone="accent" label={m.approve} title={fill(m.approveTitle, { name })} body={m.approveBody}
                  action={approveCoachProfile.bind(null, review.id)} />
                <ConfirmAction tone="neutral" withReason label={m.reject} title={fill(m.rejectTitle, { name })} body={m.rejectBody}
                  action={returnCoachProfileToDraft.bind(null, review.id)} />
              </>
            ) : null}
            {s === "published" || s === "hidden" ? (
              <ConfirmAction tone="neutral" withReason label={m.unpublish} title={fill(m.unpublishTitle, { name })} body={m.unpublishBody}
                action={returnCoachProfileToDraft.bind(null, review.id)} />
            ) : null}
            {s === "suspended" ? (
              <>
                <ConfirmAction tone="accent" label={m.restore} title={fill(m.restoreTitle, { name })} body={m.restoreBody}
                  action={restoreCoachProfile.bind(null, review.id, "published")} />
                <ConfirmAction tone="neutral" label={m.restoreDraft} title={fill(m.restoreDraftTitle, { name })} body={m.restoreDraftBody}
                  action={restoreCoachProfile.bind(null, review.id, "draft")} />
              </>
            ) : (
              <ConfirmAction withReason label={m.suspend} title={fill(m.suspendTitle, { name })} body={m.suspendBody}
                action={suspendCoachProfile.bind(null, review.id)} />
            )}
            {review.user_id ? (
              <Link href={`/admin/users/${review.user_id}`} className="inline-flex h-9 items-center rounded-xl bg-surface px-3.5 text-[12.5px] font-bold text-ink-soft hover:text-ink">
                {m.openUser}
              </Link>
            ) : null}
            {s === "published" ? (
              <Link href={`/coaches/${review.slug}`} className="inline-flex h-9 items-center rounded-xl bg-surface px-3.5 text-[12.5px] font-bold text-ink-soft hover:text-ink">
                {m.openPublic} ↗
              </Link>
            ) : null}
          </div>
        </div>
      </Section>

      <div className="mt-4">
        <Section title={m.preview} hint={m.previewHint}>
          <div className="rounded-3xl bg-bg p-2 sm:p-4">
            <CoachProfilePreview profile={review} />
          </div>
        </Section>
      </div>
    </div>
  );
}
