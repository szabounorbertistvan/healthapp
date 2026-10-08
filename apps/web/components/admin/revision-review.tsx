import Link from "next/link";
import { fill } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import { summary } from "@/lib/coach-onboarding";
import type { CoachProfileMissing } from "@/lib/coach-profile";
import { revisionDiff, type RevisionPayload, type RevisionStatus } from "@/lib/coach-revision";
import { hasRiskyClaim } from "@/lib/coach-content";
import { approveCoachRevision, rejectCoachRevision } from "@/app/admin-coach-actions";
import { ConfirmAction } from "./confirm-action";
import { Note, Pill, Section, fmtDateTime } from "./ui";

export type AdminRevision = {
  status: RevisionStatus; review_note: string | null; submitted_at: string | null;
  live: RevisionPayload; payload: RevisionPayload; missing: CoachProfileMissing[];
};

/**
 * A published coach's staged changes (20261108100000) on /admin/coaches/[id]:
 * what changed, field by field, against what is live; approve or send back.
 * The live page is untouched until approval.
 */
export async function AdminRevisionReview({ profileId, revision }: { profileId: string; revision: AdminRevision }) {
  const { t, locale } = await getI18n();
  const r = t.admin.coaches.revision;
  const groups = t.coachProfile.publish.groups;
  const diff = revisionDiff(revision.live, revision.payload);
  const missing = summary(revision.missing).filter((x) => !x.done).map((x) => groups[x.group]);
  // a nudge for the reviewer, not a verdict: pre-moderation decides
  const p = revision.payload;
  const claim = [p.headline, p.about, p.approach, p.experience_summary, ...p.services.map((s) => s.description)].some(hasRiskyClaim);
  return (
    <Section title={r.title} hint={r.hint}>
      <div className="grid gap-3 text-[13.5px]" data-testid="admin-revision" data-status={revision.status}>
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={revision.status === "pending_review" ? "warn" : "neutral"}>{revision.status}</Pill>
          {revision.submitted_at ? <span className="text-ink-faint">{fill(r.submitted, { date: fmtDateTime(revision.submitted_at, locale) })}</span> : null}
        </div>
        {missing.length ? <p className="text-warn">{fill(r.missing, { list: missing.join(", ") })}</p> : null}
        {claim ? <p className="text-warn" data-testid="admin-revision-claim">{r.claimFlag}</p> : null}
        {diff.length === 0 ? <Note>{r.noChanges}</Note> : (
          <ul className="grid gap-2">
            {diff.map((d, i) => (
              <li key={i} className="rounded-2xl bg-bg p-3">
                <p className="text-[12px] font-semibold uppercase tracking-wider text-ink-faint">
                  {r.fields[d.field]}{"change" in d ? ` · ${d.name} · ${r.change[d.change]}` : ""}
                </p>
                {d.before !== undefined ? <p className="mt-1 whitespace-pre-line text-ink-faint line-through">{d.before}</p> : null}
                {d.after !== undefined ? <p className="mt-1 whitespace-pre-line">{d.after}</p> : null}
              </li>
            ))}
          </ul>
        )}
        {revision.status === "pending_review" ? (
          <div className="flex flex-wrap gap-2">
            <ConfirmAction label={r.approve} title={r.approveTitle} body={r.approveBody} tone="accent"
              action={approveCoachRevision.bind(null, profileId) as (reason: string) => ReturnType<typeof approveCoachRevision>} />
            <ConfirmAction label={r.reject} title={r.rejectTitle} body={r.rejectBody} withReason
              action={rejectCoachRevision.bind(null, profileId)} />
          </div>
        ) : null}
      </div>
    </Section>
  );
}

/** The queue's section: every coach with changes waiting, oldest first. */
export async function AdminRevisionQueue({ rows }: { rows: { coach_profile_id: string; slug: string; display_name: string; submitted_at: string | null }[] }) {
  const { t, locale } = await getI18n();
  const r = t.admin.coaches.revision;
  return (
    <Section title={r.queue} hint={r.queueHint}>
      {rows.length === 0 ? <Note>{r.none}</Note> : (
        <ul className="grid gap-1.5 text-[13.5px]" data-testid="admin-revision-queue">
          {rows.map((row) => (
            <li key={row.coach_profile_id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-bg px-4 py-3">
              <span><span className="font-semibold">{row.display_name}</span> <span className="text-ink-faint">/coaches/{row.slug}</span></span>
              <span className="flex items-center gap-3">
                {row.submitted_at ? <span className="text-ink-faint">{fmtDateTime(row.submitted_at, locale)}</span> : null}
                <Link href={`/admin/coaches/${row.coach_profile_id}`} className="font-semibold text-accent-ink hover:underline">→</Link>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
