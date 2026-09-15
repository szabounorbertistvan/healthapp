import Link from "next/link";
import { NavIcon } from "./client-nav";
import { getI18n } from "@/lib/i18n/server";

/**
 * The admin desk has three surfaces now — users, the food library and the
 * exercise library — so each one carries the same row of tabs instead of a
 * back link to a page that is a sibling, not a parent. Server component: the
 * current tab is passed in, so there is no need for `usePathname`.
 */
export async function AdminTabs({ current }: { current: "users" | "foods" | "exercises" }) {
  const { t } = await getI18n();
  const tabs = [
    { key: "users" as const, href: "/admin", label: t.common.nav.admin, icon: "M12 3 4 6v6c0 5 3.4 8.4 8 9 4.6-.6 8-4 8-9V6zM9 12l2 2 4-4" },
    { key: "foods" as const, href: "/admin/foods", label: t.coachApp.admin.foods.link, icon: "M3 12h18a9 9 0 0 1-18 0zM8 12c0-3 2-5 5-6 2 2 3 4 1 6" },
    {
      key: "exercises" as const,
      href: "/admin/exercises",
      label: t.coachApp.admin.exercises.link,
      icon: "M2 10v4M22 10v4M5 8v8M19 8v8M8 6v12M16 6v12M8 12h8",
    },
  ];

  return (
    <nav className="flex flex-wrap gap-2">
      {tabs.map((tab) => {
        const active = tab.key === current;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`inline-flex h-10 items-center gap-2 rounded-full px-4 text-[12.5px] font-semibold ${
              active ? "bg-accent-soft text-accent-ink" : "bg-surface text-ink-soft hover:text-ink"
            }`}
          >
            <NavIcon d={tab.icon} className="h-[17px] w-[17px]" />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
