"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/clients", label: "Clients" },
  { href: "/programs", label: "Programs" },
  { href: "/nutrition", label: "Nutrition" },
  { href: "/check-ins", label: "Check-ins" },
  { href: "/messages", label: "Messages" },
  { href: "/settings", label: "Settings" },
];

export function NavLinks() {
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
              active
                ? "bg-accent-soft font-semibold text-accent-ink"
                : "text-ink-soft hover:bg-bg"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
