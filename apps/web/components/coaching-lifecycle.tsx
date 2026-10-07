"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@base-ui/react/dialog";
import { coachingMoves, END_REASONS, moveTarget, PAUSE_REASONS, type CoachingMove, type RelationshipStatus } from "@healthapp/shared";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { BUTTON, FIELD, LABEL, SMALL_BUTTON } from "@/lib/form-classes";
import type { RelationshipEvent } from "@/lib/coaching-data";
import { transitionCoaching } from "@/app/coaching-actions";

// The coaching lifecycle on screen (20261109110000): the same component for the
// client's Coach page and the coach's client pages. It offers exactly the moves
// coachingMoves() allows — which are the ones coaching_transition() accepts —
// and asks first for the two that change the relationship: Pause (what it
// does, an optional general reason) and End (what it does and does not do).

const PILL: Record<RelationshipStatus, string> = {
  active: "bg-accent-soft text-accent-ink",
  paused: "bg-warn-soft text-warn",
  ended: "bg-bg text-ink-faint",
  invited: "bg-bg text-ink-faint",
};

export function RelationshipPill({ status }: { status: RelationshipStatus }) {
  const { t } = useI18n();
  return (
    <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider ${PILL[status]}`} data-testid="relationship-status" data-status={status}>
      {t.coachProfile.coaching.statuses[status]}
    </span>
  );
}

export function CoachingActions({ relationshipId, status, otherName }: {
  relationshipId: string; status: RelationshipStatus; otherName: string;
}) {
  const { t } = useI18n();
  const c = t.coachProfile.coaching;
  const router = useRouter();
  const [busy, start] = useTransition();
  const [asking, setAsking] = useState<"pause" | "end" | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const moves = coachingMoves(status);
  if (moves.length === 0) return null;

  const run = (move: CoachingMove) => {
    setError(null);
    start(async () => {
      const result = await transitionCoaching({ relationshipId, to: moveTarget(move), reason: move === "resume" ? null : reason || null });
      if (!result.ok) {
        const code = result.errorCode as keyof typeof c.errors | undefined;
        setError((code && code in c.errors ? c.errors[code] : null) ?? c.errors.generic);
      } else {
        setAsking(null);
        setReason("");
      }
      router.refresh();
    });
  };
  const reasons = asking === "end" ? END_REASONS : PAUSE_REASONS;
  const labels = (asking === "end" ? c.endReasons : c.pauseReasons) as Record<string, string>;

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="coaching-actions">
      {moves.includes("resume") ? (
        <button type="button" className={BUTTON} disabled={busy} onClick={() => run("resume")} data-testid="coaching-resume">{c.resume}</button>
      ) : null}
      {moves.includes("pause") ? (
        <button type="button" className={SMALL_BUTTON} disabled={busy} onClick={() => setAsking("pause")} data-testid="coaching-pause">{c.pause}</button>
      ) : null}
      <button type="button" className={`${SMALL_BUTTON} text-risk`} disabled={busy} onClick={() => setAsking("end")} data-testid="coaching-end">{c.end}</button>
      {error ? <p role="alert" className="w-full text-[13px] text-risk">{error}</p> : null}

      <Dialog.Root open={asking !== null} onOpenChange={(open) => { if (!open && !busy) { setAsking(null); setReason(""); } }}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-50 bg-bg/80 backdrop-blur-sm" />
          <Dialog.Viewport className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6">
            <Dialog.Popup className="w-full max-w-md rounded-t-2xl border border-line bg-surface p-5 outline-none sm:rounded-2xl" data-testid="coaching-confirm">
              <Dialog.Title className="text-base font-bold">
                {asking === "end" ? fill(c.endTitle, { name: otherName }) : c.pauseTitle}
              </Dialog.Title>
              <Dialog.Description className="mt-2 text-[13.5px] leading-relaxed text-ink-soft">
                {asking === "end" ? c.endBody : c.pauseBody}
              </Dialog.Description>
              <label className={`${LABEL} mt-4`}>{c.reason}
                <select className={FIELD} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="coaching-reason">
                  <option value="">{c.noReason}</option>
                  {reasons.map((r) => <option key={r} value={r}>{labels[r]}</option>)}
                </select>
              </label>
              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <Dialog.Close className={SMALL_BUTTON}>{c.cancel}</Dialog.Close>
                <button type="button" className={asking === "end" ? `${BUTTON} bg-risk` : BUTTON} disabled={busy}
                  onClick={() => run(asking === "end" ? "end" : "pause")} data-testid="coaching-confirm-button">
                  {asking === "end" ? c.end : c.pause}
                </button>
              </div>
            </Dialog.Popup>
          </Dialog.Viewport>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

/** Start, pauses, resumes, end — who did each, from the reader's side. */
export function RelationshipTimeline({ events, otherName }: { events: RelationshipEvent[]; otherName: string }) {
  const { t, locale } = useI18n();
  const c = t.coachProfile.coaching;
  if (events.length === 0) return null;
  const date = (iso: string) => new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
  const reasons = { ...c.pauseReasons, ...c.endReasons } as Record<string, string>;
  return (
    <ol className="grid gap-2 border-l border-line pl-4" data-testid="relationship-history">
      {events.map((e, i) => {
        const what = e.to_status === "active" && e.from_status === "paused" ? c.events.resumed : c.events[e.to_status];
        const who = e.actor === "me" ? c.byYou : e.actor === "other" ? fill(c.byOther, { name: otherName }) : null;
        return (
          <li key={i} className="text-[13.5px]" data-to={e.to_status}>
            <span className="font-semibold">{what}</span>
            {who ? <span className="text-ink-soft"> {who}</span> : null}
            {e.reason && reasons[e.reason] ? <span className="text-ink-faint"> · {reasons[e.reason]}</span> : null}
            <span className="block text-[12px] text-ink-faint">{date(e.created_at)}</span>
          </li>
        );
      })}
    </ol>
  );
}
