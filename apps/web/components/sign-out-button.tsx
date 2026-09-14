"use client";
import { useTransition } from "react";
import { signOut } from "@/app/auth-actions";
import { useI18n } from "@/lib/i18n/client";

/**
 * Sign out. Styling is passed in because this sits in two very different
 * places: the sidebar footer, where it reads as one more nav row, and the
 * phone header, where it is a compact link next to the client's name.
 *
 * `icon` is the phone-header form: the label is the widest control in that
 * header and Romanian spends 11 characters on it ("Deconectare"), which left
 * the name truncated to "coa…". The glyph keeps the 44px target and moves the
 * words to the accessible name.
 */
export function SignOutButton({ className, icon = false }: { className?: string; icon?: boolean }) {
  const { t } = useI18n();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(async () => { await signOut(); })}
      aria-label={icon ? t.common.signOut.action : undefined}
      title={icon ? t.common.signOut.action : undefined}
      className={
        className ??
        "w-full rounded-lg px-3 py-2 text-left text-sm text-ink-soft hover:bg-bg disabled:opacity-50"
      }
    >
      {icon ? (
        <span aria-hidden="true">{pending ? "…" : "⏻"}</span>
      ) : pending ? (
        t.common.signOut.pending
      ) : (
        t.common.signOut.action
      )}
    </button>
  );
}
