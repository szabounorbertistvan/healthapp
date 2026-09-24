"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import { NavSpinner } from "./spinner";
import { FeedbackButton } from "./feedback";
import type { Dictionary } from "@/lib/i18n";

type NavKey = keyof Dictionary["common"]["nav"];

/** The client sections, in sidebar order; the first five are also the phone tab bar. Icons are 24-box stroke paths. */
const items: { href: string; key: NavKey; icon: string }[] = [
  { href: "/today", key: "today", icon: "M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" },
  { href: "/workout", key: "training", icon: "M2 10v4M22 10v4M5 8v8M19 8v8M8 6v12M16 6v12M8 12h8" },
  { href: "/food", key: "nutrition", icon: "M3 12h18a9 9 0 0 1-18 0zM8 12c0-3 2-5 5-6 2 2 3 4 1 6" },
  { href: "/habits", key: "habits", icon: "M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18M8 12l3 3 5-6" },
  { href: "/progress", key: "progress", icon: "M4 20h16M6 17v-4M11 17V9M16 17v-6M4 8l5-3 4 3 7-5M17 3h3v3" },
  { href: "/check-in", key: "checkIn", icon: "M9 4h6v3H9zM7 6H5v14h14V6h-2M9 13h6M9 17h4" },
  { href: "/challenges", key: "challenges", icon: "M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4" },
  { href: "/feed", key: "feed", icon: "M4 5h16v11H9l-5 4z" },
  { href: "/coach", key: "coach", icon: "M12 4a4 4 0 1 0 0 8 4 4 0 1 0 0-8M4 21a8 8 0 0 1 16 0" },
  // Trial / Pro hidden for now (2026-09-17) — commented out, not removed; restore when billing goes live.
  // { href: "/billing", key: "billing", icon: "M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 10h18" },
  { href: "/account", key: "account", icon: "M12 4a4 4 0 1 0 0 8 4 4 0 1 0 0-8M4 21a8 8 0 0 1 16 0M19 3v4M17 5h4" },
];

/**
 * The way back to the coaching workspace, shown only to a coach or admin who is
 * on the client surface training themselves. The two navs stay separate on
 * purpose — nineteen entries in one sidebar fits neither the eye nor a phone
 * tab bar — so each needs one visible door to the other.
 */
const BACK_ICON = "M20 12H4M10 6l-6 6 6 6";

function BackToCoaching({ sheet = false }: { sheet?: boolean }) {
  const { t } = useI18n();
  return (
    // The hairline belongs to the wrapper, not the link: a border on a rounded
    // row draws a curved edge that reads as half a box rather than a divider.
    <div className={sheet ? "mt-1 border-t border-line pt-1" : "mb-1 border-b border-line pb-1"}>
      <Link
        href="/dashboard"
        className={
          sheet
            ? "flex min-h-12 items-center gap-3 rounded-2xl px-3 text-sm font-medium text-ink-soft"
            : "flex h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium text-ink-soft hover:bg-surface hover:text-ink"
        }
      >
        <NavIcon d={BACK_ICON} />
        <span className="flex-1">{t.common.nav.coaching}</span>
        <NavSpinner />
      </Link>
    </div>
  );
}

/** A stroke icon from the nav set, or any 24-box path. */
export function NavIcon({ d, className = "h-5 w-5" }: { d: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`shrink-0 ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={d} />
    </svg>
  );
}

/** Desktop sidebar: every client section, icon + label, the active one on an accent pill. */
export function ClientNav({ coach = false }: { coach?: boolean }) {
  const pathname = usePathname();
  const { t } = useI18n();
  return (
    <nav className="flex flex-col gap-0.5">
      {coach ? <BackToCoaching /> : null}
      {items.map((item) => {
        const active = pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`flex h-10 items-center gap-3 rounded-xl px-3 text-sm ${
              active ? "bg-accent-soft font-semibold text-accent-ink" : "font-medium text-ink-soft hover:bg-surface hover:text-ink"
            }`}
          >
            <NavIcon d={item.icon} />
            <span className="flex-1">{t.common.nav[item.key]}</span>
            <NavSpinner />
          </Link>
        );
      })}
    </nav>
  );
}

/** The four sections the phone bar carries; everything else lives in the sheet. */
const TAB_HREFS = ["/today", "/workout", "/food", "/habits"];

/**
 * Phone tab bar — the client surface is thumb-first, unlike the coach desk.
 * A floating glass pane a thumb's width off the bottom edge: four cells of
 * icon + label plus "More", tall enough for the targets to clear 44px, the
 * active one in the accent with a short bar under its label. The sheet holds
 * the sections the bar cannot fit (progress, check-in, challenges, feed,
 * coach, billing) — without it, Coach and Billing could not be reached from a
 * phone at all.
 */
export function ClientTabBar({ coach = false }: { coach?: boolean }) {
  const pathname = usePathname();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  const tabs = TAB_HREFS.map((href) => items.find((i) => i.href === href)!);
  const rest = items.filter((i) => !TAB_HREFS.includes(i.href));
  const restActive = rest.some((i) => pathname.startsWith(i.href));

  // A route change should not leave the sheet hanging over the new page.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Escape closes, and the body must not scroll behind the sheet.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [open]);

  const cell =
    "relative flex h-[52px] flex-col items-center justify-center gap-0.5 text-center text-[10.5px] font-semibold leading-tight tracking-[0.01em]";

  return (
    <>
      {open ? (
        <div className="fixed inset-0 z-20 sm:hidden">
          <button
            type="button"
            aria-label={t.common.moreSheet.close}
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-bg/80"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t.common.moreSheet.title}
            className="glass glass--strong absolute inset-x-0 bottom-0 max-h-[80vh] overflow-y-auto rounded-t-3xl rounded-b-none p-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))]"
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line" />
            <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
              {t.common.moreSheet.title}
            </p>
            <nav className="flex flex-col gap-1">
              {rest.map((item) => {
                const active = pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`flex min-h-12 items-center gap-3 rounded-2xl px-3 text-sm ${
                      active ? "bg-accent-soft font-semibold text-accent-ink" : "font-medium text-ink-soft"
                    }`}
                  >
                    <NavIcon d={item.icon} />
                    <span className="flex-1">{t.common.nav[item.key]}</span>
                    <NavSpinner />
                  </Link>
                );
              })}
              {coach ? <BackToCoaching sheet /> : null}
              <div className="mt-1 border-t border-line pt-1">
                <FeedbackButton sheet />
              </div>
            </nav>
          </div>
        </div>
      ) : null}

      {/* A floating pane, clear of the screen edges and the home indicator. */}
      <nav className="glass glass--strong fixed bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-[calc(0.75rem+env(safe-area-inset-left))] right-[calc(0.75rem+env(safe-area-inset-right))] z-30 grid grid-cols-5 rounded-[26px] px-1.5 py-1.5 sm:hidden">
        {tabs.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`${cell} ${active ? "text-accent-ink" : "text-ink-faint"}`}
            >
              <NavIcon d={item.icon} className="h-[22px] w-[22px]" />
              {t.common.nav[item.key]}
              <span aria-hidden className={`mt-px h-0.5 w-4 rounded-full ${active ? "bg-accent" : "bg-transparent"}`} />
              <NavSpinner className="absolute right-1 top-0 h-2 w-2" />
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="dialog"
          className={`${cell} ${open || restActive ? "text-accent-ink" : "text-ink-faint"}`}
        >
          <NavIcon d="M5 12h.01M12 12h.01M19 12h.01" className="h-[22px] w-[22px] [stroke-width:2.6]" />
          {t.common.nav.more}
          <span aria-hidden className={`mt-px h-0.5 w-4 rounded-full ${open || restActive ? "bg-accent" : "bg-transparent"}`} />
        </button>
      </nav>
    </>
  );
}
