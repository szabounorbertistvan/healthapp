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
  approveCoachProfile, restoreCoachProfile, returnCoachProfileToDraft, setCoachVerification, setCredentialStatus,
  suspendCoachProfile,
} from "@/app/admin-coach-actions";
import type { CoachVerificationStatus, CredentialStatus } from "@/lib/coach-profile";
import { ConfirmAction } from "@/components/admin/confirm-action";
import { AdminHeader, Note, Pill, Section, fmtDateTime } from "@/components/admin/ui";
import { CoachProfilePreview } from "@/components/coach-profile/preview";
import { getAdminReviews } from "@/lib/review-data";
import { AdminReviewModeration } from "@/components/admin/review-moderation";
import { AdminRevisionReview, type AdminRevision } from "@/components/admin/revision-review";
import { getAdminRanking, getAdminReports } from "@/lib/admin/marketplace-data";
import { ReportsTable } from "@/components/admin/reports-table";
import { RankingTable } from "@/components/admin/ranking-table";

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
  verification_status: CoachVerificationStatus;
  verification_requested_at: string | null;
  verification_message: string | null;
  verification_decided_at: string | null;
  verification_note: string | null;
  credentials: {
    id: string; name: string; issuer: string | null; year: number | null; credential_number: string | null;
    expires_on: string | null; verification_status: CredentialStatus; admin_note: string | null;
  }[];
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
  // the coach's reviews, any state (20261106100000)
  const [reviews, { data: revisionData }, reports, ranking] = await Promise.all([
    review.user_id ? getAdminReviews(review.user_id) : Promise.resolve([]),
    // a published coach's staged changes (20261108100000); a database without them answers an error, read as none
    supabase.rpc("admin_coach_revision", { p_profile: id }),
    // reports about the profile and its reviews, any status (20261110110000)
    getAdminReports({ coachProfile: id, status: null, limit: 50 }),
    // where the coach stands in the default listing, and why (20261110130000)
    getAdminRanking({ profile: id, limit: 1 }),
  ]);
  const revision = (revisionData ?? null) as AdminRevision | null;
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

      {revision ? (
        <div className="mt-4">
          <AdminRevisionReview profileId={id} revision={revision} />
        </div>
      ) : null}

      <div className="mt-4">
        <Section title={t.admin.reports.coachSection}>
          {reports.length === 0 ? <Note>{t.admin.reports.coachNone}</Note> : <ReportsTable rows={reports} />}
        </Section>
      </div>

      <div className="mt-4">
        <VerificationPanel review={review} />
      </div>

      <div className="mt-4">
        <Section title={t.admin.marketplace.coachRanking} hint={t.admin.marketplace.coachRankingHint}>
          {ranking.length === 0 ? <Note>{t.admin.marketplace.notRanked}</Note> : (
            <div data-testid="admin-coach-ranking">
              <p className="mb-2 text-[13px] font-semibold">{fill(t.admin.marketplace.position, { n: ranking[0].ord })}</p>
              <RankingTable rows={ranking} />
            </div>
          )}
        </Section>
      </div>

      <div className="mt-4">
        <AdminReviewModeration rows={reviews} />
      </div>

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

/**
 * Voinic verification (20261101100000): the coach's request and message, each
 * credential with Verify / Not accepted, and the decisions the database
 * allows from this status. Separate from publishing, and never automatic.
 */
async function VerificationPanel({ review }: { review: Review }) {
  const { t, locale } = await getI18n();
  const v = t.admin.coaches.verification;
  const name = review.display_name;
  const s = review.verification_status;
  return (
    <Section title={v.title} hint={v.intro}>
      <div className="grid gap-3 text-[13.5px]" data-testid="admin-coach-verification" data-status={s}>
        <p>
          <Pill tone={s === "pending" ? "warn" : s === "verified" ? "accent" : s === "rejected" ? "risk" : "neutral"}>{v.statuses[s]}</Pill>
          {review.verification_requested_at ? (
            <span className="ml-2 text-ink-faint">{fill(v.requested, { date: fmtDateTime(review.verification_requested_at, locale) })}</span>
          ) : null}
        </p>
        {review.verification_message ? <p className="text-ink-soft">{fill(v.message, { message: review.verification_message })}</p> : null}
        {review.verification_note ? <p className="text-ink-faint">{fill(v.lastNote, { note: review.verification_note })}</p> : null}

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{v.credentials}</p>
          {review.credentials.length === 0 ? <Note>{v.noCredentials}</Note> : (
            <ul className="mt-1.5 grid gap-1.5">
              {review.credentials.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-bg px-3.5 py-2.5">
                  <span>
                    <span className="block font-semibold">{c.name}</span>
                    <span className="block text-[12px] text-ink-faint">
                      {[c.issuer, c.year, c.credential_number ? fill(v.number, { n: c.credential_number }) : null,
                        c.expires_on ? fill(v.expires, { date: c.expires_on }) : null].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    <Pill tone={c.verification_status === "verified" ? "accent" : c.verification_status === "pending" ? "warn" : c.verification_status === "rejected" ? "risk" : "neutral"}>
                      {v.credStatuses[c.verification_status]}
                    </Pill>
                    {c.verification_status !== "verified" ? (
                      <ConfirmAction tone="accent" label={v.credVerify} title={fill(v.credVerifyTitle, { name: c.name })} body={v.credVerifyBody}
                        action={setCredentialStatus.bind(null, c.id, "verified")} />
                    ) : null}
                    {c.verification_status !== "rejected" ? (
                      <ConfirmAction tone="neutral" withReason label={v.credReject} title={fill(v.credRejectTitle, { name: c.name })} body={v.credRejectBody}
                        action={setCredentialStatus.bind(null, c.id, "rejected")} />
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {s === "pending" ? (
            <>
              <ConfirmAction tone="accent" label={v.verify} title={fill(v.verifyTitle, { name })} body={v.verifyBody}
                action={setCoachVerification.bind(null, review.id, "verified")} />
              <ConfirmAction tone="neutral" withReason label={v.reject} title={fill(v.rejectTitle, { name })} body={v.rejectBody}
                action={setCoachVerification.bind(null, review.id, "rejected")} />
            </>
          ) : null}
          {s === "rejected" ? (
            <ConfirmAction tone="neutral" label={v.reopen} title={fill(v.reopenTitle, { name })} body={v.reopenBody}
              action={setCoachVerification.bind(null, review.id, "pending")} />
          ) : null}
          {s === "verified" ? (
            <ConfirmAction withReason label={v.revoke} title={fill(v.revokeTitle, { name })} body={v.revokeBody}
              action={setCoachVerification.bind(null, review.id, "rejected")} />
          ) : null}
        </div>
      </div>
    </Section>
  );
}
