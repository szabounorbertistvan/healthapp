"use client";
import { useRef } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { useI18n } from "@/lib/i18n/client";

/**
 * The app's own "are you sure?" for a destructive action — the replacement for
 * window.confirm, which blocks the page, looks like the browser rather than
 * Voinic, and cannot be driven by an E2E test. The same sheet SwipeToDelete
 * opens: portalled (a .glass parent would trap a fixed overlay, CLAUDE.md),
 * focus starts on "Keep", Escape and the backdrop cancel.
 */
export function ConfirmDialog({
  open,
  title,
  busy = false,
  confirmLabel,
  onCancel,
  onConfirm,
  testId = "confirm-dialog",
}: {
  open: boolean;
  title: string;
  busy?: boolean;
  /** Defaults to "Delete". */
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
  testId?: string;
}) {
  const { t } = useI18n();
  const m = t.clientWidgets.swipeToDelete;
  const keepRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next && !busy) onCancel(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-bg/80 backdrop-blur-sm" />
        <Dialog.Viewport className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6">
          <Dialog.Popup
            initialFocus={keepRef}
            role="alertdialog"
            className="w-full max-w-sm rounded-t-2xl border border-line bg-surface p-5 outline-none sm:rounded-2xl"
            data-testid={testId}
          >
            <Dialog.Title className="text-base font-bold">{title}</Dialog.Title>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                ref={keepRef}
                type="button"
                disabled={busy}
                onClick={onCancel}
                className="inline-flex h-10 items-center rounded-xl bg-bg px-4 text-sm font-semibold text-ink-soft hover:text-ink"
              >
                {m.keep}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={onConfirm}
                className="inline-flex h-10 items-center rounded-xl bg-risk px-4 text-sm font-bold text-white disabled:opacity-50"
                data-testid={`${testId}-confirm`}
              >
                {busy ? "…" : confirmLabel ?? m.delete}
              </button>
            </div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
