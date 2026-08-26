"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/today", label: "Today" },
  { href: "/workout", label: "Training" },
  { href: "/food", label: "Nutrition" },
  { href: "/habits", label: "Habits" },
  { href: "/progress", label: "Progress" },
  { href: "/check-in", label: "Check-in" },
  { href: "/coach", label: "Coach" },
];

export function ClientNav() {
  const pathname = usePathname();
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
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Phone-width tab bar — the client surface is thumb-first, unlike the coach desk. */
export function ClientTabBar() {
  const pathname = usePathname();
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
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
