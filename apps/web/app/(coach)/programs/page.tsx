import Link from "next/link";
import { getPrograms } from "@/lib/data";
import { Card, EmptyState } from "@/components/ui";
import { NavIcon } from "@/components/client-nav";
import { timeAgo } from "@/lib/format";
import { fill } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";

export default async function ProgramsPage() {
  const { t, locale } = await getI18n();
  const programs = await getPrograms();
  return (
    <div className="mx-auto max-w-[1600px]">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-display text-2xl font-extrabold leading-none tracking-tight sm:text-[28px]">
          {t.common.nav.programs}
        </h1>
        <Link
          href="/programs/new"
          className="flex h-11 items-center justify-center rounded-2xl bg-accent px-5 font-display text-sm font-bold text-accent-fg hover:opacity-90"
        >
          {t.coachApp.programs.newProgram}
        </Link>
      </div>

      <div className="mt-5 sm:mt-6">
        {programs.length === 0 ? (
          <EmptyState plain title={t.coachApp.programs.emptyTitle} hint={t.coachApp.programs.emptyHint} />
        ) : (
          /* As many columns as fit, never a card under 380px — one on a phone,
             several across a wide coach desk. */
          <div className="grid gap-3 sm:grid-cols-[repeat(auto-fill,minmax(380px,1fr))] sm:gap-4">
            {programs.map((p) => (
              <Link key={p.id} href={`/programs/${p.id}`} className="block h-full">
                <Card plain className="flex h-full flex-col transition hover:bg-accent-soft/40 sm:p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <NavIcon
                        d="M2 10v4M22 10v4M5 8v8M19 8v8M8 6v12M16 6v12M8 12h8"
                        className="h-9 w-9 shrink-0 text-accent-ink"
                      />
                      <div className="min-w-0">
                        <p className="truncate font-display text-lg font-bold leading-tight tracking-tight">{p.name}</p>
                        <p className="mt-1 truncate text-[13px] text-ink-soft">{p.client_name}</p>
                      </div>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                        p.status === "published" ? "bg-accent-soft text-accent-ink" : "bg-bg text-ink-faint"
                      }`}
                    >
                      {t.coachApp.programs.status[p.status] ?? p.status}
                    </span>
                  </div>
                  <div className="mt-auto flex items-end justify-between gap-3 pt-5">
                    <p className="text-[12.5px] text-ink-faint">
                      {fill(t.coachApp.programs.daysUpdated, { days: p.days, ago: timeAgo(p.updated_at, locale) })}
                    </p>
                    <span
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent-ink"
                      aria-hidden
                    >
                      <NavIcon d="m9 6 6 6-6 6" className="h-[15px] w-[15px]" />
                    </span>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
