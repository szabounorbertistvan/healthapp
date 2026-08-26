"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/lib/i18n/client";
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
            className={`rounded-lg px-3 py-2 text-sm ${
              active
                ? "bg-accent-soft font-semibold text-accent-ink"
                : "text-ink-soft hover:bg-bg"
            }`}
          >
            {t.common.nav[item.key]}
          </Link>
        );
      })}
    </nav>
  );
}
