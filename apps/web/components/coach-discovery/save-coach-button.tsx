"use client";
import { useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useI18n } from "@/lib/i18n/client";
import { toggleCoachSave } from "@/app/coach-profile-actions";

const BOOKMARK = "M6 3h12v18l-6-4.5L6 21z";

/**
 * Save a coach to the reader's private shortlist (/coaches/saved), or take
 * them off it — not Follow: nothing about a save is public, the coach never
 * learns of it. The state flips at once (useOptimistic) and falls back to
 * the server's if the write fails; no page reload either way.
 *
 * Anonymous readers get a link into the existing sign-in flow
 * (/login?next=<this page>); no record is ever written for them. The coach's
 * own card / page draws nothing (the caller passes `hidden`).
 *
 *   icon — a 40 px bookmark for a card corner;
 *   pill — the bookmark and its label, beside Follow on the profile.
 */
export function SaveCoachButton({ profileId, saved, signedIn, variant = "icon", signInNext, signInParams }: {
  profileId: string | null;
  saved: boolean;
  signedIn: boolean;
  variant?: "icon" | "pill";
  /** Where to come back after signing in — the coach page passes itself with ?intent=save (20261108100000). */
  signInNext?: string;
  /** utm_* of this visit, carried through the sign-in (20261110120000). */
  signInParams?: Record<string, string>;
}) {
  const { t } = useI18n();
  const s = t.coachProfile.saved;
  const pathname = usePathname();
  const search = useSearchParams();
  const [pending, start] = useTransition();
  // the last state the server confirmed; the optimistic one rides on it during the request
  const [confirmed, setConfirmed] = useState(saved);
  const [state, setState] = useOptimistic(confirmed, (_, next: boolean) => next);
  const [error, setError] = useState<string | null>(null);

  const label = state ? s.savedLabel : s.save;
  const look = variant === "icon"
    ? `h-10 w-10 rounded-full ${state ? "bg-accent text-accent-fg" : "bg-bg text-ink-soft hover:text-ink"}`
    : `h-12 gap-2 rounded-2xl px-4 text-[14px] font-semibold ${state ? "bg-accent-soft text-accent-ink" : "bg-surface text-ink hover:bg-accent-soft/60"}`;
  const icon = (
    <svg viewBox="0 0 24 24" aria-hidden className="h-[18px] w-[18px]" fill={state ? "currentColor" : "none"} stroke="currentColor"
      strokeWidth={2} strokeLinejoin="round"><path d={BOOKMARK} /></svg>
  );
  const base = `inline-flex shrink-0 items-center justify-center transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${look}`;

  if (!signedIn || !profileId) {
    const here = signInNext ?? `${pathname}${search?.toString() ? `?${search}` : ""}`;
    return (
      <Link href={`/login?${new URLSearchParams({ next: here, ...signInParams })}`} className={base} title={s.signInToSave}
        aria-label={variant === "icon" ? s.signInToSave : undefined} data-testid="save-coach" data-mkt="cta_save" data-mkt-wall="save">
        {icon}
        {variant === "pill" ? <span>{s.save}</span> : null}
      </Link>
    );
  }

  return (
    <>
      <button
        type="button" disabled={pending} aria-pressed={state} title={error ?? label}
        aria-label={variant === "icon" ? label : undefined} data-testid="save-coach" data-saved={state} data-mkt={state ? undefined : "cta_save"}
        className={`${base} disabled:opacity-60 ${error ? "ring-2 ring-risk/60" : ""}`}
        onClick={() => {
          setError(null);
          start(async () => {
            setState(!state);
            const result = await toggleCoachSave(profileId, state);
            if (!result.ok) setError(result.message ?? s.error);
            else setConfirmed(result.saved ?? !state);
          });
        }}
      >
        {icon}
        {variant === "pill" ? <span>{label}</span> : null}
      </button>
      <span role="status" className="sr-only">{error ?? ""}</span>
    </>
  );
}
