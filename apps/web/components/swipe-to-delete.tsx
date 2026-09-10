"use client";
import { useRef, useState, type PointerEvent, type ReactNode } from "react";

// How far the row slides, and how far it must go before letting go commits.
// Both are fixed pixels rather than a fraction of the row: on a wide screen a
// percentage threshold would sit past the end of the slide and never be met.
const REVEAL = 96;
const COMMIT = 64;
// Movement below this is not yet a direction, only a wobble.
const SLOP = 10;

/**
 * Swipe a row leftwards to trigger a destructive action. Touch only — a mouse
 * has the written button next to it, and dragging rows with a cursor is not a
 * gesture anyone expects.
 *
 * The row does not delete anything itself; it reports the swipe and lets the
 * caller confirm.
 */
export function SwipeToDelete({
  label,
  onTrigger,
  children,
}: {
  label: string;
  onTrigger: () => void;
  children: ReactNode;
}) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const claimed = useRef(false);
  const [dx, setDx] = useState(0);

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.pointerType === "mouse") return;
    start.current = { x: e.clientX, y: e.clientY };
    claimed.current = false;
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const from = start.current;
    if (!from) return;
    const moveX = e.clientX - from.x;
    const moveY = e.clientY - from.y;

    if (!claimed.current) {
      // Until the direction is unambiguous the gesture stays the browser's, so
      // the page still scrolls. A tie counts as vertical and ends the gesture
      // for good: scrolling must never cost the user a delete prompt.
      if (Math.abs(moveX) < SLOP && Math.abs(moveY) < SLOP) return;
      if (Math.abs(moveX) <= Math.abs(moveY)) {
        start.current = null;
        return;
      }
      claimed.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    setDx(Math.min(0, Math.max(-REVEAL, moveX)));
  }

  function onPointerUp() {
    const committed = claimed.current && Math.abs(dx) >= COMMIT;
    start.current = null;
    claimed.current = false;
    setDx(0);
    if (committed) onTrigger();
  }

  return (
    <div className="relative overflow-hidden rounded-xl">
      <div
        aria-hidden
        className="absolute inset-y-0 right-0 flex w-24 items-center justify-center bg-risk text-sm font-semibold text-bg"
      >
        {label}
      </div>
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          transform: `translateX(${dx}px)`,
          transition: dx === 0 ? "transform 150ms ease-out" : "none",
          touchAction: "pan-y",
        }}
        className="relative"
      >
        {children}
      </div>
    </div>
  );
}
