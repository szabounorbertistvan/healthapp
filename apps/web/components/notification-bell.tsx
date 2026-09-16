"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { timeAgo } from "@/lib/format";
import type { NotificationRow } from "@/lib/notifications-data";
import { markNotificationsRead } from "@/app/client-actions-app";
import { NavIcon } from "./client-nav";

/**
 * The bell and its panel. The rows are handed down from the layout, which
 * already reads them server-side — the panel does not fetch, so opening it
 * costs nothing and works on the first paint.
 *
 * Opening marks everything read. That is the honest behaviour for a list whose
 * whole content is reminders: keeping a badge alive after someone has looked at
 * it trains them to ignore it.
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
   * outside the viewport — so that copy opens upwards. The phone header is at
   * the top and opens downwards.
   */
  placement?: "up" | "down";
}) {
  const { t, locale } = useI18n();
  const n = t.common.notifications;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(false);
  const [, start] = useTransition();
  const box = useRef<HTMLDivElement>(null);

  // Close on an outside click or Escape — the panel is not a modal, so it must
  // not trap anything, and a stray click anywhere else should dismiss it.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
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

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && unread > 0 && !seen) {
      setSeen(true);
      start(async () => {
        await markNotificationsRead();
        router.refresh();
      });
    }
  }

  const badge = seen ? 0 : unread;

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label={badge > 0 ? `${n.label}: ${fill(n.unreadCount, { count: badge })}` : n.label}
        title={n.label}
        aria-expanded={open}
        className="relative inline-flex h-11 w-11 items-center justify-center rounded-lg border border-line bg-surface text-ink-soft hover:text-ink sm:h-9 sm:w-9"
      >
        <NavIcon d="M12 4a5 5 0 0 0-5 5v3l-1.5 3h13L17 12V9a5 5 0 0 0-5-5M10 18a2 2 0 0 0 4 0" className="h-[18px] w-[18px]" />
        {badge > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-accent px-1 font-display text-[10px] font-bold tabular-nums text-accent-fg">
            {badge > 9 ? "9+" : badge}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          className={`absolute z-40 w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-3xl bg-surface shadow-xl ring-1 ring-line/60 ${
            // Anchored on the side it has room to grow into: the sidebar sits
            // against the left screen edge, so a right-anchored panel wider
            // than the 15rem column would run off the page.
            placement === "up" ? "bottom-[calc(100%+6px)] left-0" : "top-[calc(100%+6px)] right-0"
          }`}
        >
          <p className="px-4 pb-1.5 pt-4 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            {n.title}
          </p>
          {notifications.length === 0 ? (
            <div className="px-4 pb-4 pt-1">
              <p className="text-[13.5px] font-semibold">{n.empty}</p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-ink-faint">{n.emptyHint}</p>
            </div>
          ) : (
            <ul className="max-h-[min(60vh,26rem)] divide-y divide-line/60 overflow-y-auto">
              {notifications.map((item) => {
                const body = (
                  <>
                    <p className="text-[13.5px] font-semibold leading-snug">{item.title}</p>
                    {item.body ? (
                      <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-soft">{item.body}</p>
                    ) : null}
                    <p className="mt-1 text-[11.5px] text-ink-faint">{timeAgo(item.created_at, locale)}</p>
                  </>
                );
                return (
                  <li key={item.id} className={item.read ? "" : "bg-accent-soft/40"}>
                    {item.href ? (
                      <Link href={item.href} onClick={() => setOpen(false)} className="block px-4 py-3 hover:bg-bg/60">
                        {body}
                      </Link>
                    ) : (
                      <div className="px-4 py-3">{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
