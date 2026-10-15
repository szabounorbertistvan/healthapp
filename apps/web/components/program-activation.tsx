"use client";
import { settle } from "@/lib/settle-action";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { activateProgram } from "@/app/builder-actions";
import { copyRoutine } from "@/app/routine-actions";
import { copyName } from "@healthapp/shared";
import { useI18n } from "@/lib/i18n/client";
import { NavIcon } from "./client-nav";
import { Card } from "./ui";

/**
 * The open program's state and the moves that change it, above the builder:
 *
 *   Draft      — not in Training yet; publishing it is the builder's own button.
 *   Active     — the next workout comes from here (pickProgram picks it).
 *   Not active — published, listed in Training, but another program is followed;
 *                "Set as active" makes this one the program to follow.
 *
 * Plus the two moves that live on the routine page already and are only
 * pointed at from here, not rebuilt: Duplicate (copy_program — an independent
 * copy, never activated, so copying cannot change what is followed) and the
 * details (name, description, goal, level, length).
 *
 * `activation` null = the read failed: no state is claimed and no button
 * offered rather than guessing. `canActivate` false hides the button for
 * anyone the database would refuse anyway (a read-only coach).
 */
export function ProgramActivation({
  programId,
  programName,
  activation,
  canActivate,
  detailsHref,
  duplicateHref,
  forCoach = false,
}: {
  programId: string;
  programName: string;
  activation: { published: boolean; followed: boolean } | null;
  canActivate: boolean;
  detailsHref: string;
  /** Where the copy opens (the builder with ?program=<id>); omitted = no Duplicate here. */
  duplicateHref?: (id: string) => string;
  /** The coach's builder: the hints speak about the client. */
  forCoach?: boolean;
}) {
  const { t } = useI18n();
  const b = t.clientApp.builder;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  function activate() {
    setError(null);
    setNote(null);
    startTransition(async () => {
      const result = await settle(() => activateProgram(programId), t.common.actions.unreachable);
      if (!result.ok) {
        setError(result.message ?? b.activateFailed);
        return;
      }
      setNote(result.message ?? b.activated);
      router.refresh();
    });
  }

  function duplicate() {
    if (!duplicateHref) return;
    setError(null);
    setNote(null);
    startTransition(async () => {
      const result = await settle(
        () => copyRoutine({ sourceId: programId, name: copyName(programName) }),
        t.common.actions.unreachable,
      );
      if (!result.ok || !result.id) {
        setError(result.message ?? b.duplicateFailed);
        return;
      }
      // Open the copy: editing it is why it was made, and staying on the
      // original would read as "nothing happened".
      router.push(duplicateHref(result.id));
      router.refresh();
    });
  }

  const state = activation === null ? null : !activation.published ? "draft" : activation.followed ? "active" : "inactive";

  return (
    <Card plain className="space-y-3 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{b.statusLabel}</p>
          {state ? (
            <p className="mt-1 flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full px-2.5 py-1 text-[11.5px] font-bold ${
                  state === "active" ? "bg-accent-soft text-accent-ink" : state === "draft" ? "bg-warn-soft text-warn" : "bg-bg text-ink-soft"
                }`}
              >
                {state === "active" ? b.statusActive : state === "draft" ? b.draft : b.statusInactive}
              </span>
              <span className="text-[12.5px] text-ink-faint">
                {state === "active"
                  ? (forCoach ? b.statusActiveHintCoach : b.statusActiveHint)
                  : state === "draft" ? b.statusDraftHint
                  : (forCoach ? b.statusInactiveHintCoach : b.statusInactiveHint)}
              </span>
            </p>
          ) : (
            <p className="mt-1 text-[12.5px] text-ink-faint">{b.statusUnknown}</p>
          )}
        </div>
        {state === "inactive" && canActivate ? (
          <button
            type="button"
            disabled={pending}
            onClick={activate}
            className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-accent px-4 text-[12.5px] font-bold text-accent-fg hover:opacity-90 disabled:opacity-50"
          >
            <NavIcon d="M5 12l5 5 9-11" className="h-4 w-4 [stroke-width:2.4]" />
            {b.setActive}
          </button>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <Link
          href={detailsHref}
          className="inline-flex h-9 items-center gap-1.5 rounded-full bg-bg px-3.5 text-[12.5px] font-semibold text-ink-soft hover:text-ink"
        >
          <NavIcon d="M4 20h4l10-10-4-4L4 16zM13 7l4 4" className="h-4 w-4" />
          {b.editDetails}
        </Link>
        {duplicateHref ? (
          <button
            type="button"
            disabled={pending}
            onClick={duplicate}
            className="inline-flex h-9 items-center gap-1.5 rounded-full bg-bg px-3.5 text-[12.5px] font-semibold text-ink-soft hover:text-ink disabled:opacity-50"
          >
            <NavIcon d="M8 8h11v11H8zM5 16V5h11" className="h-4 w-4" />
            {t.clientApp.routines.duplicate}
          </button>
        ) : null}
      </div>

      {/* role=status so a screen reader hears the outcome of the button it just pressed */}
      <div role="status" aria-live="polite">
        {note ? <p className="text-[12.5px] font-semibold text-accent-ink">{note}</p> : null}
        {error ? <p className="text-[12.5px] font-semibold text-risk">{error}</p> : null}
      </div>
    </Card>
  );
}
