import Link from "next/link";
import { requireAdmin } from "@/lib/admin/guard";
import { displayName } from "@/lib/data";
import { getI18n } from "@/lib/i18n/server";
import { Logo, LogoMark } from "@/components/logo";
import { Avatar } from "@/components/social";
import { LanguageSelector } from "@/components/language-selector";
import { ThemeToggle } from "@/components/theme-toggle";
import { SignOutButton } from "@/components/sign-out-button";
import { NavIcon } from "@/components/client-nav";
import { AdminMobileNav, AdminNav, type AdminNavItem } from "@/components/admin/nav";
import { SearchInput } from "@/components/admin/ui";

/**
 * The admin panel's own shell. Separate from the coach layout on purpose: an
 * admin is not a coach with extra tabs, and the panel's sections have nothing
 * to do with a roster. requireAdmin() is the gate; every read under here goes
 * through an admin_* RPC that checks again in SQL.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireAdmin();
  const { t } = await getI18n();
  const n = t.admin.nav;
  const items: AdminNavItem[] = [
    { href: "/admin", label: n.overview, icon: "M4 5h7v6H4zM13 5h7v4h-7zM13 11h7v8h-7zM4 13h7v6H4z" },
    { href: "/admin/users", label: n.users, icon: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M2 20a7 7 0 0 1 14 0M17 11a3 3 0 0 0 0-6M18 20h4a6 6 0 0 0-3-5.2" },
    { href: "/admin/activity", label: n.activity, icon: "M4 6h16M4 12h10M4 18h7M17 15l2 2 4-4" },
    { href: "/admin/auth", label: n.auth, icon: "M12 3 4 6v6c0 5 3.4 8.4 8 9 4.6-.6 8-4 8-9V6zM12 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4v5" },
    { href: "/admin/invitations", label: n.invitations, icon: "M4 6h16v12H4zM4 7l8 6 8-6" },
    { href: "/admin/workouts", label: n.workouts, icon: "M2 10v4M22 10v4M5 8v8M19 8v8M8 6v12M16 6v12M8 12h8" },
    { href: "/admin/exercises", label: n.exercises, icon: "M4 4h12a2 2 0 0 1 2 2v14H6a2 2 0 0 0-2 2zM4 4v18M8 8h6" },
    { href: "/admin/nutrition", label: n.nutrition, icon: "M3 12h18a9 9 0 0 1-18 0zM8 12c0-3 2-5 5-6 2 2 3 4 1 6" },
    { href: "/admin/foods", label: n.foods, icon: "M5 4h14v4H5zM5 8v12h14V8M9 12h6" },
    { href: "/admin/social", label: n.social, icon: "M4 5h16v11H9l-5 4z" },
    { href: "/admin/challenges", label: n.challenges, icon: "M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4" },
    { href: "/admin/notifications", label: n.notifications, icon: "M12 4a5 5 0 0 0-5 5v3l-1.5 3h13L17 12V9a5 5 0 0 0-5-5M10 18a2 2 0 0 0 4 0" },
    { href: "/admin/feedback", label: n.feedback, icon: "M4 5h16v11H9l-5 4zM12 8v3M12 13.5h.01" },
    { href: "/admin/errors", label: n.errors, icon: "M12 9v4M12 17h.01M10.3 4.3 2.6 18a1.6 1.6 0 0 0 1.4 2.4h16a1.6 1.6 0 0 0 1.4-2.4L13.7 4.3a1.6 1.6 0 0 0-2.8 0z" },
    { href: "/admin/system", label: n.system, icon: "M4 6h16v5H4zM4 13h16v5H4zM7 8.5h.01M7 15.5h.01" },
  ];
  const name = displayName(profile);

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col px-3.5 pb-5 pt-6 lg:flex">
        <Link href="/admin" className="flex items-center gap-2 px-2.5">
          <Logo size="sm" />
          <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-accent-ink">{t.admin.title}</span>
        </Link>
        <Link href="/settings" className="mt-2.5 flex items-center gap-2 px-2.5 text-xs text-ink-faint hover:text-ink">
          <Avatar name={name} url={profile.avatar_url} size="h-7 w-7" />
          <span className="truncate">{name}</span>
          <span className="ml-auto text-[10px] font-semibold uppercase tracking-wider text-accent-ink">admin</span>
        </Link>
        <form action="/admin/search" method="GET" className="mt-4 px-1">
          <SearchInput value={null} placeholder={t.admin.search.title + "…"} />
        </form>
        <div className="mt-3"><AdminNav items={items} /></div>
        <div className="mt-auto space-y-3 px-1 pt-6">
          <Link href="/dashboard" className="flex h-9 items-center gap-3 rounded-xl px-3 text-[13px] font-medium text-ink-soft hover:bg-surface hover:text-ink">
            <NavIcon d="M15 18l-6-6 6-6" className="h-4 w-4" />
            {n.backToCoaching}
          </Link>
          <div className="flex items-center gap-2">
            <LanguageSelector />
            <ThemeToggle />
          </div>
          <SignOutButton />
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="glass glass--strong sticky top-2 z-10 mx-3 flex h-14 items-center justify-between gap-2 rounded-2xl px-2 pl-3.5 lg:hidden">
          <span className="flex min-w-0 items-center gap-2 text-[15px] font-bold tracking-tight">
            <LogoMark className="h-6 w-6" px={24} />
            <span className="truncate">{t.admin.title}</span>
            <span className="truncate text-[12px] font-medium text-ink-faint">· {name}</span>
          </span>
          <div className="flex shrink-0 items-center gap-1.5">
            <Link href="/admin/search" aria-label={t.admin.search.title} title={t.admin.search.title} className="inline-flex h-11 w-11 items-center justify-center rounded-lg glass glass--subtle glass--interactive text-ink-soft hover:text-ink">
              <NavIcon d="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16M21 21l-4.3-4.3" className="h-[18px] w-[18px]" />
            </Link>
            <LanguageSelector />
            <ThemeToggle />
            <AdminMobileNav items={[...items, { href: "/dashboard", label: n.backToCoaching, icon: "M15 18l-6-6 6-6" }]} labels={{ menu: n.menu, close: n.close }} />
          </div>
        </header>
        <main className="min-w-0 flex-1 px-4 pb-16 pt-4 sm:px-8 lg:pt-7">
          <div className="mx-auto max-w-[1600px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
