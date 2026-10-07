"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Dialog } from "@base-ui/react/dialog";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import type { CoachProfileRow } from "@/lib/coach-profile";
import { statusView, summary, type StatusView } from "@/lib/coach-onboarding";
import { BUTTON, SMALL_BUTTON } from "@/lib/form-classes";
import {
  becomeCoach, discardCoachRevision, hideCoachProfile, saveCoachProfileDraft, showCoachProfile, startCoachRevision, withdrawCoachProfile,
} from "@/app/coach-profile-actions";
import type { ActionResult } from "@/app/actions";
import { Card, Switch } from "../ui";

export const COACH_PROFILE_PATH = "/settings/coach-profile";

/** One line of copy for a failed coach-profile action. */
export function useCoachError() {
  const { t } = useI18n();
  const e = t.coachProfile.errors;
  return (result: ActionResult) =>
    (result.errorCode && result.errorCode in e ? e[result.errorCode as keyof typeof e] : null)
      ?? (result.errorCode === "NO_ROWS" ? e.PROFILE_LOCKED : null)
      ?? e.generic;
}

const TONE: Record<StatusView["tone"], string> = {
  neutral: "bg-bg text-ink-soft",
  warn: "bg-warn-soft text-warn",
  accent: "bg-accent-soft text-accent-ink",
  risk: "bg-risk-soft text-risk",
};

export function StatusBadge({ status }: { status: CoachProfileRow["status"] }) {
  const { t } = useI18n();
  const view = statusView(status);
  return (
    <span
      data-testid="coach-profile-status"
      data-status={status}
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider ${TONE[view.tone]}`}
    >
      {t.coachProfile.status[status]}
    </span>
  );
}

/**
 * The entry point for anyone without a coach profile: a client on /account, or
 * a coach on /settings who never made one. become_coach() makes the draft (and
 * a client `both`), then the wizard opens.
 */
export function BecomeCoachCard() {
  const { t } = useI18n();
  const b = t.coachProfile.become;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run() {
    setError(null);
    start(async () => {
      const result = await becomeCoach();
      if (result.ok) {
        router.push(COACH_PROFILE_PATH);
        return;
      }
      setError(
        result.errorCode === "PROFILE_INCOMPLETE" ? b.errIncomplete
          : result.errorCode === "ACCOUNT_UNAVAILABLE" ? b.errUnavailable
          : t.coachProfile.errors.generic,
      );
    });
  }

  return (
    <Card plain>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{b.title}</p>
      <p className="mt-2 text-[13.5px] leading-relaxed text-ink-soft">{b.body}</p>
      <button type="button" onClick={run} disabled={pending} className={`${BUTTON} mt-4`}>
        {pending ? b.busy : b.button}
      </button>
      {error ? <p role="alert" className="mt-2.5 text-[13px] text-risk">{error}</p> : null}
    </Card>
  );
}

/** The coach's /settings: where the profile stands, one tap into it. */
export function CoachProfileSettingsCard({ status }: { status: CoachProfileRow["status"] | null }) {
  const { t } = useI18n();
  const c = t.coachProfile.card;
  if (status === null) return <BecomeCoachCard />;
  return (
    <Card plain>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{c.title}</p>
        <StatusBadge status={status} />
      </div>
      <Link href={COACH_PROFILE_PATH} className={`${BUTTON} mt-4`}>
        {status === "draft" ? t.coachProfile.status.continueSetup : c.open}
      </Link>
    </Card>
  );
}

/**
 * Where the profile stands, on top of the wizard. Outside `draft` the steps
 * are read-only (the database refuses the writes anyway): "Edit profile"
 * withdraws it to draft first — out of review, or offline if published — so
 * nothing changes on a public page without an admin approving it again.
 *
 * Published ↔ hidden is the coach's own switch (20261029100000): instant, and
 * no review, because a hidden profile cannot be edited either.
 */
export function CoachProfileStatusPanel({ profile, editing = false }: {
  profile: CoachProfileRow;
  /** A staged revision is open (20261108100000): the editor is below, no Edit button. */
  editing?: boolean;
}) {
  const { t } = useI18n();
  const s = t.coachProfile.status;
  const router = useRouter();
  const coachError = useCoachError();
  const view = statusView(profile.status);
  const [accepting, setAccepting] = useState(profile.accepting_clients);
  const [confirming, setConfirming] = useState(false);
  const [confirmingHide, setConfirmingHide] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const body =
    profile.status === "draft" ? s.draftBody
      : profile.status === "pending_review" ? s.pendingBody
      : profile.status === "published" ? s.publishedBody
      : profile.status === "hidden" ? s.hiddenBody
      : s.suspendedBody;

  function toggleAccepting(next: boolean) {
    setError(null);
    setAccepting(next);
    start(async () => {
      const result = await saveCoachProfileDraft({ acceptingClients: next });
      if (!result.ok) {
        setAccepting(!next);
        setError(coachError(result));
      }
    });
  }

  function hide() {
    setError(null);
    start(async () => {
      const result = await hideCoachProfile();
      setConfirmingHide(false);
      if (!result.ok) {
        setError(coachError(result));
        return;
      }
      router.refresh();
    });
  }

  function show() {
    setError(null);
    start(async () => {
      const result = await showCoachProfile();
      if (result.missing?.length) {
        const groups = t.coachProfile.publish.groups;
        setError(fill(s.showMissing, { list: summary(result.missing).filter((x) => !x.done).map((x) => groups[x.group]).join(", ") }));
        return;
      }
      if (!result.ok) {
        setError(coachError(result));
        return;
      }
      router.refresh();
    });
  }

  // a live profile (published / hidden) is edited as a copy and stays up;
  // one in review is withdrawn to draft, as before
  const live = profile.status === "published" || profile.status === "hidden";
  function withdraw() {
    setError(null);
    start(async () => {
      const result = live ? await startCoachRevision() : await withdrawCoachProfile();
      setConfirming(false);
      if (!result.ok) {
        setError(coachError(result));
        return;
      }
      router.refresh();
    });
  }

  return (
    <Card plain>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <StatusBadge status={profile.status} />
        <div className="flex flex-wrap gap-2">
          {view.action === "view" ? (
            <Link href={`/coaches/${profile.slug}`} className={SMALL_BUTTON}>{s.viewPublic}</Link>
          ) : null}
          {profile.status === "published" ? (
            <button type="button" className={SMALL_BUTTON} disabled={pending} onClick={() => setConfirmingHide(true)}
              data-testid="coach-hide">
              {s.hide}
            </button>
          ) : null}
          {profile.status === "hidden" ? (
            <button type="button" className={BUTTON} disabled={pending} onClick={show} data-testid="coach-show">
              {s.show}
            </button>
          ) : null}
          {(view.action === "edit" || view.action === "view") && !editing ? (
            <button type="button" className={SMALL_BUTTON} disabled={pending} onClick={() => setConfirming(true)}>
              {s.edit}
            </button>
          ) : null}
        </div>
      </div>
      <p className="mt-3 text-[13.5px] leading-relaxed text-ink-soft">{body}</p>
      {profile.status === "suspended" && profile.suspension_reason ? (
        <p className="mt-2 text-[13.5px] leading-relaxed text-risk">{fill(s.suspendedReason, { reason: profile.suspension_reason })}</p>
      ) : null}
      {profile.status === "draft" && profile.review_note ? (
        <p className="mt-2 rounded-2xl bg-warn-soft px-3.5 py-2.5 text-[13.5px] leading-relaxed text-warn">
          {fill(s.reviewNote, { note: profile.review_note })}
        </p>
      ) : null}
      {profile.status === "pending_review" || profile.status === "published" || profile.status === "hidden" ? (
        <div className="mt-4">
          <Switch
            checked={accepting} onChange={toggleAccepting} disabled={pending}
            label={s.accepting} hint={s.acceptingHint} onLabel={t.coachProfile.wizard.on} offLabel={t.coachProfile.wizard.off}
          />
        </div>
      ) : null}
      {error ? <p role="alert" className="mt-2.5 text-[13px] text-risk">{error}</p> : null}

      <Dialog.Root open={confirming} onOpenChange={setConfirming}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-50 bg-bg/80 backdrop-blur-sm" />
          <Dialog.Viewport className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6">
            <Dialog.Popup className="w-full max-w-md rounded-t-2xl border border-line bg-surface p-5 outline-none sm:rounded-2xl">
              <Dialog.Title className="text-base font-bold">{s.editConfirmTitle}</Dialog.Title>
              <Dialog.Description className="mt-2 text-[13.5px] leading-relaxed text-ink-soft">
                {live ? s.editLiveConfirm : s.editPendingConfirm}
              </Dialog.Description>
              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <Dialog.Close className={SMALL_BUTTON}>{s.cancel}</Dialog.Close>
                <button type="button" className={BUTTON} disabled={pending} onClick={withdraw}>
                  {s.editConfirm}
                </button>
              </div>
            </Dialog.Popup>
          </Dialog.Viewport>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={confirmingHide} onOpenChange={setConfirmingHide}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-50 bg-bg/80 backdrop-blur-sm" />
          <Dialog.Viewport className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6">
            <Dialog.Popup className="w-full max-w-md rounded-t-2xl border border-line bg-surface p-5 outline-none sm:rounded-2xl">
              <Dialog.Title className="text-base font-bold">{s.hideTitle}</Dialog.Title>
              <Dialog.Description className="mt-2 text-[13.5px] leading-relaxed text-ink-soft">{s.hideBody}</Dialog.Description>
              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <Dialog.Close className={SMALL_BUTTON}>{s.cancel}</Dialog.Close>
                <button type="button" className={BUTTON} disabled={pending} onClick={hide} data-testid="coach-hide-confirm">
                  {s.hideConfirm}
                </button>
              </div>
            </Dialog.Popup>
          </Dialog.Viewport>
        </Dialog.Portal>
      </Dialog.Root>
    </Card>
  );
}

/**
 * Above the editor while a staged revision is open (20261108100000): the
 * public page is untouched; this says where the copy stands — being edited,
 * waiting for an admin, or sent back with a note — and offers to discard it.
 */
export function CoachRevisionBanner({ revision }: { revision: NonNullable<import("@/lib/coach-profile").MyCoachProfile["revision"]> }) {
  const { t } = useI18n();
  const r = t.coachProfile.status.revision;
  const router = useRouter();
  const coachError = useCoachError();
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const body = revision.status === "pending_review" ? r.pending : revision.status === "rejected" ? r.rejected : r.editing;
  return (
    <Card plain>
      <div data-testid="coach-revision" data-status={revision.status}>
        <p className="font-display text-lg font-bold tracking-tight">{r.title}</p>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-soft">{body}</p>
        {revision.status === "rejected" && revision.review_note ? (
          <p className="mt-2 rounded-2xl bg-warn-soft px-3.5 py-2.5 text-[13.5px] leading-relaxed text-warn">
            {fill(r.note, { note: revision.review_note })}
          </p>
        ) : null}
        {error ? <p role="alert" className="mt-2 text-[13px] text-risk">{error}</p> : null}
        <div className="mt-3 flex flex-wrap gap-2">
          {confirm ? (
            <>
              <span className="text-[13px] text-ink-soft">{r.discardConfirm}</span>
              <button type="button" className={SMALL_BUTTON} disabled={pending} data-testid="coach-revision-discard-confirm"
                onClick={() => start(async () => {
                  const result = await discardCoachRevision();
                  if (!result.ok) setError(coachError(result));
                  setConfirm(false);
                  router.refresh();
                })}>{r.discard}</button>
              <button type="button" className="px-2 text-[13px] font-semibold text-ink-faint hover:text-ink" onClick={() => setConfirm(false)}>✕</button>
            </>
          ) : (
            <button type="button" className={SMALL_BUTTON} onClick={() => setConfirm(true)} data-testid="coach-revision-discard">{r.discard}</button>
          )}
        </div>
      </div>
    </Card>
  );
}
