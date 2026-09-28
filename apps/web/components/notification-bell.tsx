"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import type { NotificationRow } from "@/lib/notifications-data";
import { markNotificationsRead } from "@/app/client-actions-app";
import { NavIcon } from "./client-nav";
import { NotificationRowView } from "./notification-list";

/**
 * The bell and its panel. The rows are handed down from the layout, which
 * already reads them server-side — the panel does not fetch, so opening it
 * costs nothing and works on the first paint.
 *
 * Opening marks everything read — the way the big feeds do it: the badge is
 * "there is something you have not seen", and opening the panel is seeing
 * it. The badge clears on the tap, not when the write comes back; the rows
 * that were new keep their highlight while the panel stays open, so what was
 * new is still visible; the refresh that follows settles both bells
 * (sidebar and phone header).
 */
export function NotificationBell({
  notifications,
  unread,
  placement = "down",
}: {
  notifications: NotificationRow[];
  unread: number;
  /**
   * Which way the panel opens. The desktop sidebar puts this button at the
   * very bottom of the screen, where a panel dropping downwards lands entirely
   * outside the viewport — so that copy opens upwards, hung off the bell
   * itself. The phone header is at the top and opens downwards — but there
   * the bell is one of five buttons in the middle of a glass strip, and a
   * panel hung off it fails twice: anchored to a 44px button it runs off
   * whichever screen edge it faces, and nested inside the header's
   * backdrop-filter it can only blur the header's own pixels, so the page
   * shows through it razor-sharp. So `down` portals the panel out to the
   * body as a fixed sheet under the header, edge to edge and behind a scrim,
   * the way the phone "More" sheet sits beside the tab bar rather than in it.
   */
  placement?: "up" | "down";
}) {
  const { t } = useI18n();
  const n = t.common.notifications;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // When this browser last opened the panel. Until the refresh lands the
  // layout still hands down the old `unread`, so the badge is computed from
  // the rows instead: only what arrived after this moment counts. A plain
  // "dismissed" flag hid badges that had legitimately come back; a count
  // double-subtracted once the refresh had already removed them.
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  // The rows that were unread when the panel opened: highlighted while it is
  // open, even though the server has already marked them read.
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const [, start] = useTransition();
  const box = useRef<HTMLDivElement>(null);
  // The portalled sheet is not a DOM descendant of `box`, so the outside-click
  // test has to know about it separately or a tap on a row would dismiss the
  // panel before the link's click ever fired.
  const panel = useRef<HTMLDivElement>(null);
  // Where the sheet starts: just under the header the bell sits in, measured
  // when it opens rather than hardcoded to the header's height.
  const [sheetTop, setSheetTop] = useState(0);

  // Close on an outside click or Escape — the panel is not a modal, so it must
  // not trap anything, and a stray click anywhere else should dismiss it.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (box.current?.contains(t) || panel.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const badge = dismissedAt === null
    ? unread
    : notifications.filter((item) => !item.read && Date.parse(item.created_at) > dismissedAt).length;

  function toggle() {
    const next = !open;
    if (next) {
      if (placement === "down") {
        const strip = box.current?.closest("header");
        setSheetTop((strip?.getBoundingClientRect().bottom ?? 0) + 6);
      }
      setFresh(new Set(notifications.filter((item) => !item.read).map((item) => item.id)));
      if (badge > 0) {
        setDismissedAt(Date.now());
        start(async () => {
          await markNotificationsRead();
          router.refresh();
        });
      }
    }
    setOpen(next);
  }

  const body = (
    <>
      <div className="px-4 pb-1.5 pt-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{n.title}</p>
      </div>
      {notifications.length === 0 ? (
        <div className="px-4 pb-4 pt-1">
          <p className="text-[13.5px] font-semibold">{n.empty}</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-faint">{n.emptyHint}</p>
        </div>
      ) : (
        <ul className="max-h-[min(60vh,26rem)] divide-y divide-line/60 overflow-y-auto">
          {notifications.map((item) => {
            const unreadRow = !item.read || fresh.has(item.id);
            const row = <NotificationRowView notification={item} unread={unreadRow} compact />;
            return (
              <li key={item.id} className={unreadRow ? "bg-accent-soft/40" : ""}>
                {item.href ? (
                  <Link href={item.href} onClick={() => setOpen(false)} className="block hover:bg-bg/60">
                    {row}
                  </Link>
                ) : (
                  row
                )}
              </li>
            );
          })}
        </ul>
      )}
      {/* The bell holds the latest few; the center holds all of them, paged. */}
      <Link
        href="/notifications"
        onClick={() => setOpen(false)}
        className="block border-t border-line/60 px-4 py-3 text-center text-[12.5px] font-semibold text-accent-ink hover:bg-bg/60"
      >
        {n.seeAll}
      </Link>
    </>
  );

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label={badge > 0 ? `${n.label}: ${fill(n.unreadCount, { count: badge })}` : n.label}
        title={n.label}
        aria-expanded={open}
        className="relative inline-flex h-11 w-11 items-center justify-center rounded-lg glass glass--subtle glass--interactive text-ink-soft hover:text-ink sm:h-9 sm:w-9"
      >
        <NavIcon d="M12 4a5 5 0 0 0-5 5v3l-1.5 3h13L17 12V9a5 5 0 0 0-5-5M10 18a2 2 0 0 0 4 0" className="h-[18px] w-[18px]" />
        {badge > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-accent px-1 font-display text-[10px] font-bold tabular-nums text-accent-fg">
            {badge > 9 ? "9+" : badge}
          </span>
        ) : null}
      </button>

      {open && placement === "up" ? (
        // Anchored on the side it has room to grow into: the sidebar sits
        // against the left screen edge, so a right-anchored panel wider than
        // the 15rem column would run off the page.
        <div
          ref={panel}
          className="glass glass--strong absolute bottom-[calc(100%+6px)] left-0 z-40 w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-3xl"
        >
          {body}
        </div>
      ) : null}

      {open && placement === "down"
        ? createPortal(
            // Below the header (z-10) so the strip and its bell stay crisp and
            // tappable above the scrim; below the tab bar (z-30) for the same
            // reason.
            <div className="fixed inset-0 z-[5] sm:hidden">
              <button type="button" aria-label={t.common.actions.close} onClick={() => setOpen(false)} className="absolute inset-0 bg-bg/60" />
              <div
                ref={panel}
                style={{ top: sheetTop }}
                className="glass glass--strong absolute inset-x-3 overflow-hidden rounded-3xl"
              >
                {body}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
