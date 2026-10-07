"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useI18n } from "@/lib/i18n/client";

/**
 * The coach's marketplace sections (20261108100000), over the pages that
 * already exist — nothing is duplicated, each tab is the page it always was.
 * One row that scrolls sideways on a phone; the sidebar has one Marketplace
 * entry for all of them.
 */
const TABS = [
  { key: "overview", href: "/marketplace" },
  { key: "profile", href: "/settings/coach-profile" },
  { key: "services", href: "/settings/coach-profile?step=5" },
  { key: "availability", href: "/bookings/availability" },
  { key: "requests", href: "/requests" },
  { key: "bookings", href: "/bookings" },
  { key: "reviews", href: "/reviews" },
] as const;

export function MarketplaceTabs() {
  const { t } = useI18n();
  const m = t.coachProfile.marketplace.tabs;
  const pathname = usePathname();
  const step = useSearchParams()?.get("step");
  const active = (tab: (typeof TABS)[number]) => {
    if (tab.key === "services") return pathname === "/settings/coach-profile" && step === "5";
    if (tab.key === "profile") return pathname === "/settings/coach-profile" && step !== "5";
    if (tab.key === "bookings") return pathname === "/bookings";
    return pathname === tab.href || pathname.startsWith(`${tab.href}/`);
  };
  return (
    <nav aria-label={t.common.nav.marketplace} className="-mx-4 mb-5 overflow-x-auto px-4 sm:mx-0 sm:px-0" data-testid="marketplace-tabs">
      <ul className="flex w-max gap-1.5">
        {TABS.map((tab) => (
          <li key={tab.key}>
            <Link href={tab.href} aria-current={active(tab) ? "page" : undefined}
              className={`inline-flex h-10 items-center whitespace-nowrap rounded-full px-4 text-[13.5px] font-semibold ${
                active(tab) ? "bg-accent text-accent-fg" : "bg-surface text-ink-soft hover:text-ink"}`}>
              {m[tab.key]}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
