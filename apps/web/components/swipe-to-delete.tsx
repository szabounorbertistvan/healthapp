"use client";
import { useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { useI18n } from "@/lib/i18n/client";

const REVEAL_PX = 88;
const DRAG_THRESHOLD_PX = 8;

/**
 * Swipe the wrapped card to the left to reveal a delete action; tapping it asks
 * once more before calling `onDelete`. Vertical scrolling is untouched
 * (`touch-action: pan-y`), and a swipe never fires the card's own click — the
 * card is usually a link, and a drag that ends in a navigation is the classic
 * mobile-list bug. A small trash button at the top right does the same for
 * mouse users, who cannot swipe — or, when `children` is a function, the
 * caller receives that button and places it itself, for cards whose top
 * right corner is already taken (the day editor's header).
 */
export function SwipeToDelete({
  children,
  onDelete,
  confirmText,
  disabled = false,
  className = "",
}: {
  children: ReactNode | ((trigger: ReactNode) => ReactNode);
  onDelete: () => void | Promise<void>;
  /** The question shown before deleting, e.g. Delete “Legs A”? */
  confirmText: string;
  disabled?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  const m = t.clientWidgets.swipeToDelete;
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const axis = useRef<"none" | "x" | "y">("none");
  const dragged = useRef(false);

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (disabled || confirming) return;
    // Buttons inside the reveal are not draggable — let them be tapped.
    if ((e.target as HTMLElement).closest("[data-swipe-action]")) return;
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    axis.current = "none";
    dragged.current = false;
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!start.current || start.current.id !== e.pointerId) return;
    const dx = e.clientX - start.current.x;
    const dy = e.clientY - start.current.y;
    if (axis.current === "none") {
      if (Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) return;
      axis.current = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (axis.current === "x") e.currentTarget.setPointerCapture(e.pointerId);
    }
    if (axis.current !== "x") return;
    dragged.current = true;
    const base = open ? -REVEAL_PX : 0;
    setOffset(Math.min(0, Math.max(-REVEAL_PX, base + dx)));
  }

  function onPointerUp(e: PointerEvent<HTMLDivElement>) {
    if (!start.current || start.current.id !== e.pointerId) return;
    start.current = null;
    if (axis.current !== "x") return;
    const shouldOpen = offset < -REVEAL_PX / 2;
    setOpen(shouldOpen);
    setOffset(shouldOpen ? -REVEAL_PX : 0);
  }

  function close() {
    setOpen(false);
    setOffset(0);
    setConfirming(false);
  }

  async function confirmDelete() {
    setBusy(true);
    try {
      await onDelete();
    } finally {
      setBusy(false);
      close();
    }
  }

  function toggle() {
    if (open) close();
    else {
      setOpen(true);
      setOffset(-REVEAL_PX);
    }
  }

  const trash = (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 10v6M14 10v6" />
    </svg>
  );
  const placed = typeof children === "function";
  // The header variant matches the coach builder's day chrome (h-9 round, bg-bg).
  const trigger = (
    <button
      type="button"
      data-swipe-action
      disabled={disabled}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggle();
      }}
      aria-label={m.delete}
      title={m.delete}
      className={
        placed
          ? "grid h-9 w-9 shrink-0 place-items-center rounded-full bg-bg text-ink-faint hover:bg-risk-soft hover:text-risk disabled:opacity-50"
          : "absolute right-3 top-3 hidden h-8 w-8 items-center justify-center rounded-xl text-ink-faint hover:bg-risk-soft hover:text-risk sm:flex"
      }
    >
      {trash}
    </button>
  );

  return (
    // On a phone the clipping box extends REVEAL_PX to the left of the card
    // (negative margin + matching padding), so a card slid fully open keeps
    // its title visible instead of losing its left edge inside its own border
    // — that edge is the screen edge, exactly as a native list behaves. From
    // `sm` up the cards sit in a grid, where that strip is the neighbouring
    // card: there the card stays put and the tray lays over its right edge.
    <div
      className={`relative -ml-22 overflow-hidden pl-22 sm:ml-0 sm:pl-0 ${className}`}
      style={{ touchAction: "pan-y" }}
    >
      {/* the red tray behind the card (over it from `sm`, where the card does not move) */}
      <div
        className={`absolute inset-y-0 right-0 flex w-22 items-stretch sm:z-10 ${open || offset !== 0 ? "" : "invisible"}`}
        aria-hidden={!open}
      >
        <button
          type="button"
          data-swipe-action
          tabIndex={open ? 0 : -1}
          onClick={() => setConfirming(true)}
          className="flex w-full items-center justify-center rounded-r-3xl bg-risk text-xs font-bold text-white"
        >
          {m.delete}
        </button>
      </div>

      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClickCapture={(e) => {
          // A drag must not also count as a tap on the card.
          if (dragged.current) {
            e.preventDefault();
            e.stopPropagation();
            dragged.current = false;
          } else if (open && !confirming) {
            // Tapping the card while the tray shows just closes the tray.
            e.preventDefault();
            e.stopPropagation();
            close();
          }
        }}
        // h-full: a wrapper stretched by a grid row must pass its height on to
        // the card, or the tray (inset-y-0 on the wrapper) shows below it.
        className="relative h-full select-none [transform:translateX(var(--swipe-x))] sm:[transform:none]"
        style={{
          "--swipe-x": `${offset}px`,
          transition: start.current ? "none" : "transform 160ms ease-out",
        } as CSSProperties}
      >
        {placed ? children(trigger) : children}
        {!placed && !disabled && !open ? trigger : null}
      </div>

      {confirming ? (
        <div
          role="alertdialog"
          aria-label={m.confirm}
          className="absolute inset-y-0 left-22 right-0 z-10 flex flex-col items-start justify-center gap-2 rounded-3xl bg-surface/95 p-4 backdrop-blur-sm sm:left-0"
        >
          <p className="text-sm font-semibold">{confirmText}</p>
          <div className="flex gap-2">
            <button
              type="button"
              data-swipe-action
              disabled={busy}
              onClick={confirmDelete}
              className="rounded-xl bg-risk px-3.5 py-2 text-xs font-bold text-white disabled:opacity-50"
            >
              {busy ? "…" : m.delete}
            </button>
            <button
              type="button"
              data-swipe-action
              disabled={busy}
              onClick={close}
              className="rounded-xl bg-bg px-3.5 py-2 text-xs font-semibold text-ink-soft hover:text-ink"
            >
              {m.keep}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
