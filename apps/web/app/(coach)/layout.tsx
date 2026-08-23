import Link from "next/link";
import { isDemo } from "@/lib/supabase/server";
import { NavLinks } from "@/components/nav-links";

export default function CoachLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-52 shrink-0 flex-col border-r border-line bg-surface p-4 sm:flex">
        <Link href="/dashboard" className="mb-6 flex items-center gap-2 px-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-sm font-black text-white">B</span>
          <span className="text-base font-extrabold tracking-tight">BuddyGym</span>
        </Link>
        <NavLinks />
        <div className="mt-auto px-2 pt-6">
          {isDemo ? (
            <p className="rounded-lg bg-warn-soft px-3 py-2 text-[11px] leading-snug text-warn">
              <b>Demo mode</b> — sample data. Set Supabase env vars in <code>.env.local</code> to go live.
            </p>
          ) : null}
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-5 sm:p-8">{children}</main>
    </div>
  );
}
