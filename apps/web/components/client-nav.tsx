"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/lib/i18n/client";
import type { Dictionary } from "@/lib/i18n";

const items: { href: string; key: keyof Dictionary["common"]["nav"] }[] = [
  { href: "/today", key: "today" },
  { href: "/workout", key: "training" },
  { href: "/food", key: "nutrition" },
  { href: "/habits", key: "habits" },
  { href: "/progress", key: "progress" },
  { href: "/check-in", key: "checkIn" },
  { href: "/coach", key: "coach" },
  { href: "/billing", key: "billing" },
];

export function ClientNav() {
  const pathname = usePathname();
  const { t } = useI18n();
  return (
    <nav className="flex flex-col gap-1">
      {items.map((item) => {
        const active = pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`rounded-lg px-3 py-2 text-sm ${
              active ? "bg-accent-soft font-semibold text-accent-ink" : "text-ink-soft hover:bg-bg"
            }`}
          >
            {t.common.nav[item.key]}
          </Link>
        );
      })}
    </nav>
  );
}

/** Phone-width tab bar — the client surface is thumb-first, unlike the coach desk.
 *  A floating box rather than a flush strip: the old bar was ~40px tall, under
 *  the 44px a thumb needs. Targets grew ~25% on the vertical axis only — the
 *  five labels share 375px on a phone and "Antrenament" already spends most of
 *  its cell, so width has none to give. Active wears the same accent pill as
 *  ClientNav above, so sidebar and tab bar read as one nav. */
export function ClientTabBar() {
  const pathname = usePathname();
  const { t } = useI18n();
  const tabs = items.slice(0, 5);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-10 px-2 pb-2 sm:hidden">
      <nav className="pointer-events-auto flex gap-0.5 rounded-2xl border border-line bg-surface p-1 shadow-lg">
        {tabs.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-[50px] flex-1 items-center justify-center rounded-xl px-0.5 text-center text-[11px] font-semibold leading-tight ${
                active ? "bg-accent-soft text-accent-ink" : "text-ink-faint"
              }`}
            >
              {t.common.nav[item.key]}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
