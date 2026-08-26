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

/** Phone-width tab bar — the client surface is thumb-first, unlike the coach desk. */
export function ClientTabBar() {
  const pathname = usePathname();
  const { t } = useI18n();
  const tabs = items.slice(0, 5);
  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 flex border-t border-line bg-surface sm:hidden">
      {tabs.map((item) => {
        const active = pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex-1 py-3 text-center text-[11px] font-semibold ${
              active ? "text-accent-ink" : "text-ink-faint"
            }`}
          >
            {t.common.nav[item.key]}
          </Link>
        );
      })}
    </nav>
  );
}
