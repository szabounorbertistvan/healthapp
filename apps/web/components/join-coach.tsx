"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { acceptInvite } from "@/app/client-actions";
import { inviteMessage } from "@healthapp/api";
import { useI18n } from "@/lib/i18n/client";

/**
 * "I have a coach" — reveal a code box, claim the invite.
 *
 * Lives on its own because two screens need it and they must not drift: the
 * onboarding choice at /welcome, and the Coach tab, which is where someone who
 * already has an account actually looks. /welcome is reachable only while the
 * account is still empty (today/page.tsx redirects there), so before this the
 * code box vanished the moment a client built a program or picked "I train on
 * my own", and there was no second way in.
 *
 * `redirectTo` is for the onboarding case, where joining should leave the
 * welcome screen behind. Without it the caller just refreshes in place.
 */
export function JoinCoach({ redirectTo, autoFocus = true }: { redirectTo?: string; autoFocus?: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const w = t.clientApp.welcome;

  // Every code accept_invite can raise, paired with its localized line. Written
  // out rather than defaulted: a new code in RPC_ERRORS must fail to compile
  // here, not quietly render as "could not use that code".
  const inviteCopy = {
    INVALID_CODE: w.errInvalidCode,
    EXPIRED: w.errExpired,
    ALREADY_HAS_COACH: w.errAlreadyHasCoach,
    CLIENT_LIMIT_REACHED: w.errClientLimit,
    UNKNOWN: w.errUnknown,
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-11 w-full rounded-lg border border-line px-4 py-2.5 text-sm font-semibold hover:border-accent"
      >
        {w.haveCode}
      </button>
    );
  }

  return (
    <>
      <input
        autoFocus={autoFocus}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder={w.codePlaceholder}
        className="min-h-11 w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm uppercase outline-none focus:border-accent"
      />
      <button
        type="button"
        disabled={pending || !code.trim()}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const r = await acceptInvite(code);
            if (!r.ok) {
              setError(inviteMessage(inviteCopy, r.errorCode));
              return;
            }
            if (redirectTo) router.push(redirectTo);
            else router.refresh();
          })
        }
        className="min-h-11 w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-fg disabled:opacity-40"
      >
        {w.useCode}
      </button>
      {error ? <p className="text-sm text-risk" role="alert">{error}</p> : null}
    </>
  );
}
