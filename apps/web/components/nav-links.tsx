"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import { NavSpinner } from "./spinner";
import type { Dictionary } from "@/lib/i18n";

const items: { href: string; key: keyof Dictionary["common"]["nav"] }[] = [
  { href: "/dashboard", key: "dashboard" },
  { href: "/clients", key: "clients" },
  { href: "/programs", key: "programs" },
  { href: "/library", key: "library" },
  { href: "/nutrition", key: "nutrition" },
  { href: "/check-ins", key: "checkIns" },
  { href: "/messages", key: "messages" },
  { href: "/settings", key: "settings" },
];

const adminItem = { href: "/admin", key: "admin" as const };

export function NavLinks({ isAdmin = false }: { isAdmin?: boolean }) {
  const pathname = usePathname();
  const { t } = useI18n();
  const visible = isAdmin ? [...items, adminItem] : items;
  return (
    <nav className="flex flex-col gap-1">
      {visible.map((item) => {
        const active = pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm ${
              active
                ? "bg-accent-soft font-semibold text-accent-ink"
                : "text-ink-soft hover:bg-bg"
            }`}
          >
            {t.common.nav[item.key]}
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
    "flex min-h-[50px] flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-0.5 text-center text-[11px] font-semibold leading-tight";

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
            className="absolute inset-x-0 bottom-0 max-h-[80vh] overflow-y-auto rounded-t-2xl border-t border-line bg-surface p-4 pb-[calc(5rem+env(safe-area-inset-bottom))] shadow-lg"
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line" />
            <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">
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
                    className={`flex min-h-11 items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm ${
                      active ? "bg-accent-soft font-semibold text-accent-ink" : "text-ink-soft hover:bg-bg"
                    }`}
                  >
                    {t.common.nav[item.key]}
                    <NavSpinner />
                  </Link>
                );
              })}
            </nav>
          </div>
        </div>
      ) : null}

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-10 px-2 pb-2 sm:hidden">
        <nav className="pointer-events-auto flex gap-0.5 rounded-2xl border border-line bg-surface p-1 shadow-lg">
          {tabs.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`${cell} ${active ? "bg-accent-soft text-accent-ink" : "text-ink-faint"}`}
              >
                {t.common.nav[item.key]}
                <NavSpinner className="h-2.5 w-2.5" />
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-haspopup="dialog"
            className={`${cell} ${open || restActive ? "bg-accent-soft text-accent-ink" : "text-ink-faint"}`}
          >
            <span aria-hidden="true" className="text-base leading-none">⋯</span>
            {t.common.nav.more}
          </button>
        </nav>
      </div>
    </>
  );
}
