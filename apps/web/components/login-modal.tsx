"use client";
import Link from "next/link";
import { useRef, type KeyboardEvent, type MouseEvent } from "react";
import { useI18n } from "@/lib/i18n/client";
import { Logo } from "@/components/logo";
import { LoginForm, type LoginMode } from "@/components/login-form";

/**
 * A link to /login that, once JavaScript is running, opens the sign-in form in
 * a native <dialog> instead of navigating. Closes on the X, on Escape (built in)
 * and on a click on the backdrop. Without JS the link still goes to /login.
 */
export function LoginModal({
  label,
  mode = "signin",
  className = "",
}: {
  label: string;
  mode?: LoginMode;
  className?: string;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);

  function open(e: MouseEvent) {
    if (!ref.current?.showModal) return; // very old browser: let the link navigate
    e.preventDefault();
    ref.current.showModal();
    // land on the first field, not on the close button
    ref.current.querySelector<HTMLInputElement>("input")?.focus();
  }

  // <dialog> closes on Escape natively; this also covers environments that
  // deliver the key to the panel's contents without firing the cancel event.
  function onKeyDown(e: KeyboardEvent<HTMLDialogElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      ref.current?.close();
    }
  }

  function onBackdropClick(e: MouseEvent<HTMLDialogElement>) {
    // the dialog element itself is only hit when the click lands outside the panel
    if (e.target === e.currentTarget) ref.current?.close();
  }

  return (
    <>
      <Link href="/login" onClick={open} className={className}>
        {label}
      </Link>
      <dialog
        ref={ref}
        onClick={onBackdropClick}
        onKeyDown={onKeyDown}
        aria-label={label}
        className="login-dialog m-auto w-[calc(100%-2rem)] max-w-sm rounded-2xl border border-line bg-bg p-0 text-ink shadow-2xl"
      >
        <div className="p-5">
          <div className="mb-5 flex items-center justify-between">
            <Logo size="sm" />
            <button
              type="button"
              onClick={() => ref.current?.close()}
              aria-label={t.common.actions.close}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft hover:bg-surface hover:text-ink"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
          <LoginForm initialMode={mode} />
        </div>
      </dialog>
    </>
  );
}
