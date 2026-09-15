"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import { NavIcon } from "./client-nav";
import { NavSpinner } from "./spinner";
import type { Dictionary } from "@/lib/i18n";

type NavKey = keyof Dictionary["common"]["nav"];

/** The coach sections, in sidebar order. Icons are 24-box stroke paths. */
const items: { href: string; key: NavKey; icon: string }[] = [
  { href: "/dashboard", key: "dashboard", icon: "M4 5h7v6H4zM13 5h7v4h-7zM13 11h7v8h-7zM4 13h7v6H4z" },
  { href: "/clients", key: "clients", icon: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M2 20a7 7 0 0 1 14 0M17 11a3 3 0 0 0 0-6M18 20h4a6 6 0 0 0-3-5.2" },
  { href: "/programs", key: "programs", icon: "M2 10v4M22 10v4M5 8v8M19 8v8M8 6v12M16 6v12M8 12h8" },
  { href: "/library", key: "library", icon: "M4 4h12a2 2 0 0 1 2 2v14H6a2 2 0 0 0-2 2zM4 4v18M8 8h6" },
  { href: "/nutrition", key: "nutrition", icon: "M3 12h18a9 9 0 0 1-18 0zM8 12c0-3 2-5 5-6 2 2 3 4 1 6" },
  { href: "/check-ins", key: "checkIns", icon: "M9 4h6v3H9zM7 6H5v14h14V6h-2M9 13h6M9 17h4" },
  { href: "/messages", key: "messages", icon: "M4 5h16v11H9l-5 4z" },
  { href: "/settings", key: "settings", icon: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.3a2 2 0 1 1-4 0v-.2a1.6 1.6 0 0 0-2.8-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3.5 15H3a2 2 0 1 1 0-4h.2A1.6 1.6 0 0 0 4.3 8.2l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 2.7-1.1V4a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 2.8 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.3a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.3.9z" },
];

const adminItem = { href: "/admin", key: "admin" as const, icon: "M12 3 4 6v6c0 5 3.4 8.4 8 9 4.6-.6 8-4 8-9V6zM9 12l2 2 4-4" };

/** Desktop sidebar: every coach section, icon + label, the active one on an accent pill. */
export function NavLinks({ isAdmin = false }: { isAdmin?: boolean }) {
  const pathname = usePathname();
  const { t } = useI18n();
  const visible = isAdmin ? [...items, adminItem] : items;
  return (
    <nav className="flex flex-col gap-0.5">
      {visible.map((item) => {
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

/** Phone-width tab bar for the coach desk.
 *
 *  The sidebar is `sm:flex`, so below that breakpoint the coach surface used to
 *  have no navigation at all — you landed on /dashboard and stayed there. The
 *  client surface already solved this with ClientTabBar; this is the same
 *  pattern, with one difference: the coach has nine destinations and a phone
 *  fits five, so the fifth is a sheet holding the rest.
 *
 *  Which four earn a tab: the daily loop is dashboard → clients → programs →
 *  check-ins. Messages rides in the header instead, mirroring how the client
 *  header carries the feed — both are "someone is waiting on you" surfaces and
 *  both want to be one tap from anywhere.
 */
const TAB_ITEMS = ["/dashboard", "/clients", "/programs", "/check-ins"];

export function CoachTabBar({ isAdmin = false }: { isAdmin?: boolean }) {
  const pathname = usePathname();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  const all = isAdmin ? [...items, adminItem] : items;
  const tabs = TAB_ITEMS.map((href) => all.find((i) => i.href === href)!);
  // everything the tab bar cannot show, minus messages (it lives in the header)
  const rest = all.filter((i) => !TAB_ITEMS.includes(i.href) && i.href !== "/messages");
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
            className="absolute inset-x-0 bottom-0 max-h-[80vh] overflow-y-auto rounded-t-3xl bg-surface p-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))]"
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
            </nav>
          </div>
        </div>
      ) : null}

      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-surface px-1.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] pt-2 sm:hidden">
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
