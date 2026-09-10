"use client";
import { useEffect, useRef, type MouseEvent, type SyntheticEvent } from "react";

/**
 * Confirmation for a destructive action, on the same native <dialog> the
 * sign-in modal uses (components/login-modal.tsx): the browser supplies the
 * focus trap, Escape and the inert background, and globals.css supplies the
 * themed backdrop.
 *
 * `open` is owned by the caller, so every close path — Escape, backdrop, the
 * cancel button — reports back rather than closing behind the caller's back
 * and leaving its state claiming the dialog is still up.
 *
 * Focus lands on cancel, not on the destructive button: an accidental Enter
 * should hit the safe option.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel,
  pending = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el?.showModal) return; // very old browser: nothing to open
    if (open && !el.open) {
      el.showModal();
      cancelRef.current?.focus();
    } else if (!open && el.open) {
      el.close();
    }
  }, [open]);

  // Escape fires `cancel` on the element; hand it to the caller instead of
  // letting the browser close a dialog the caller still thinks is open.
  function onDialogCancel(e: SyntheticEvent<HTMLDialogElement>) {
    e.preventDefault();
    if (!pending) onCancel();
  }

  // The dialog element itself is only the hit target when the click landed
  // outside the panel.
  function onBackdropClick(e: MouseEvent<HTMLDialogElement>) {
    if (e.target === e.currentTarget && !pending) onCancel();
  }

  return (
    <dialog
      ref={ref}
      onCancel={onDialogCancel}
      onClick={onBackdropClick}
      aria-label={title}
      className="confirm-dialog m-auto w-[calc(100%-2rem)] max-w-sm rounded-2xl border border-line bg-bg p-0 text-ink shadow-2xl"
    >
      <div className="space-y-4 p-5">
        <p className="font-display text-lg font-bold">{title}</p>
        <p className="text-sm leading-snug text-ink-soft">{body}</p>
        <div className="flex gap-2">
          <button
            ref={cancelRef}
            type="button"
            disabled={pending}
            onClick={onCancel}
            className="flex-1 rounded-lg border border-line px-4 py-2.5 text-sm font-semibold hover:border-accent disabled:opacity-40"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={onConfirm}
            className="flex-1 rounded-lg bg-risk px-4 py-2.5 text-sm font-semibold text-bg hover:opacity-90 disabled:opacity-40"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
