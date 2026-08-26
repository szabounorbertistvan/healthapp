import Link from "next/link";
import { redirect } from "next/navigation";
import { getProfile } from "@/lib/data";
import { isDemo } from "@/lib/supabase/server";
import { DEMO_CLIENT_NAME } from "@/lib/demo-client-store";
import { ClientNav, ClientTabBar } from "@/components/client-nav";
import { LanguageSelector } from "@/components/language-selector";
import { APP_NAME, APP_INITIAL } from "@/lib/brand";
import { getI18n } from "@/lib/i18n/server";
import { ViewSwitcher } from "@/components/view-switcher";
import { viewableClients } from "@/app/view-actions";
import { viewingClientId } from "@/lib/view-mode";

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
        <Link href="/today" className="mb-2 flex items-center gap-2 px-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-sm font-black text-white">
            {APP_INITIAL}
          </span>
          <span className="text-base font-extrabold tracking-tight">{APP_NAME}</span>
        </Link>
        <p className="mb-5 px-2 text-xs text-ink-faint">{name}</p>
        <ClientNav />
        <div className="mt-auto space-y-3 pt-6">
          <LanguageSelector />
          {isDemo ? (
            <ViewSwitcher surface="client" clients={clients} activeClientId={activeClientId} />
          ) : null}
          {isDemo ? (
            <p className="rounded-lg bg-warn-soft px-3 py-2 text-[11px] leading-snug text-warn">
              <b>{t.common.demoNotice.title}</b> — {t.common.demoNotice.body}
            </p>
          ) : null}
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-5 pb-20 sm:p-8 sm:pb-8">{children}</main>
      {/* The sidebar (and its selector) is hidden on phones — float one instead. */}
      <div className="fixed right-3 top-3 z-20 sm:hidden">
        <LanguageSelector />
      </div>
      <ClientTabBar />
    </div>
  );
}
