import Link from "next/link";
import { redirect } from "next/navigation";
import { getProfile } from "@/lib/data";
import { isDemo } from "@/lib/supabase/server";
import { DEMO_CLIENT_NAME } from "@/lib/demo-client-store";
import { ClientNav, ClientTabBar } from "@/components/client-nav";
import { LanguageSelector } from "@/components/language-selector";
import { ThemeToggle } from "@/components/theme-toggle";
import { Logo } from "@/components/logo";
import { getI18n } from "@/lib/i18n/server";
import { ViewSwitcher } from "@/components/view-switcher";
import { viewableClients } from "@/app/view-actions";
import { viewingClientId } from "@/lib/view-mode";
import { SignOutButton } from "@/components/sign-out-button";

export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  // Demo mode has no auth, so the shell renders as the fixed demo client.
  // Live mode is the real gate: coaches belong in the coach workspace.
  let name = DEMO_CLIENT_NAME;
  let clients: { id: string; name: string }[] = [];
  let activeClientId: string | undefined;

  if (isDemo) {
    clients = await viewableClients();
    activeClientId = await viewingClientId();
    name = clients.find((c) => c.id === activeClientId)?.name ?? DEMO_CLIENT_NAME;
  } else {
    const profile = await getProfile();
    if (!profile) redirect("/");
    if (profile.role === "coach") redirect("/dashboard");
    name = profile.full_name;
  }
  const { t } = await getI18n();

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-52 shrink-0 flex-col border-r border-line bg-surface p-4 sm:flex">
        <Link href="/" className="mb-2 flex items-center gap-2 px-2">
          <Logo size="sm" />
        </Link>
        <p className="mb-5 px-2 text-xs text-ink-faint">{name}</p>
        <ClientNav />
        <div className="mt-auto space-y-3 pt-6">
          <div className="flex items-center gap-2">
            <LanguageSelector />
            <ThemeToggle />
          </div>
          {isDemo ? (
            <ViewSwitcher surface="client" clients={clients} activeClientId={activeClientId} />
          ) : null}
          {isDemo ? (
            <p className="rounded-lg bg-warn-soft px-3 py-2 text-[11px] leading-snug text-warn">
              <b>{t.common.demoNotice.title}</b> — {t.common.demoNotice.body}
            </p>
          ) : null}
          <SignOutButton />
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        {/* The sidebar (with its language selector and sign-out) is desktop-only
            and the tab bar has no room to spare, so the phone gets its own slim
            header carrying both. Without it a client on the surface they
            actually use could never switch language or sign out. */}
        <header className="flex items-center justify-between gap-3 border-b border-line bg-surface px-5 py-3 sm:hidden">
          <span className="truncate text-sm font-bold tracking-tight">{name}</span>
          <div className="flex shrink-0 items-center gap-3">
            <div className="flex items-center gap-2">
            <LanguageSelector />
            <ThemeToggle />
          </div>
            <SignOutButton className="text-xs font-semibold text-ink-soft hover:text-ink disabled:opacity-50" />
          </div>
        </header>
        <main className="flex-1 p-5 pb-20 sm:p-8 sm:pb-8">{children}</main>
      </div>
      <ClientTabBar />
    </div>
  );
}
