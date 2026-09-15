import Link from "next/link";
import { getCoachChallenges } from "@/lib/challenges-data";
import { Card, EmptyState } from "@/components/ui";
import { NavIcon } from "@/components/client-nav";
import { ChallengeProgressBar, ChallengeStatusBadge } from "@/components/challenges";
import { fill } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";

/**
 * Read-only: which challenges the coach's active clients have joined and how
 * far each one is. No management here — challenges are platform-owned in v1.
 * Lives under /clients because it is a view of the roster, and because the
 * client surface already owns /challenges (route groups share one URL space).
 */
export default async function CoachChallengesPage() {
  const { t, locale } = await getI18n();
  const ch = t.common.challenges;
  const rows = await getCoachChallenges();
  const nf = new Intl.NumberFormat(locale === "ro" ? "ro-RO" : "en-GB");

  return (
    // A list of cards: as many columns as fit, never a card under 380px.
    <div className="mx-auto max-w-[1600px]">
      <Link
        href="/clients"
        className="inline-flex h-9 items-center gap-1.5 rounded-full bg-surface px-3.5 text-[12.5px] font-semibold text-ink-soft hover:text-ink"
      >
        <NavIcon d={ICON.back} className="h-[15px] w-[15px]" />
        {t.common.nav.clients}
      </Link>
      <h1 className="mt-4 font-display text-2xl font-extrabold leading-none tracking-tight sm:text-[28px]">
        {ch.coachTitle}
      </h1>

      <div className="mt-5 sm:mt-6">
        {rows.length === 0 ? (
          <EmptyState plain title={ch.coachEmpty} hint={ch.emptyHint} />
        ) : (
          <div className="grid items-start gap-3 sm:grid-cols-[repeat(auto-fill,minmax(380px,1fr))] sm:gap-4">
            {rows.map(({ challenge: c, clients }) => (
              <Card key={c.id} plain className="overflow-hidden p-0">
                <div className="flex items-start justify-between gap-3 px-5 pb-4 pt-[18px]">
                  <div className="min-w-0">
                    <h2 className="truncate font-display text-lg font-bold tracking-tight">{c.title}</h2>
                    <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-faint">
                      {ch.type[c.type]} · {ch.target}: <span className="tabular-nums">{nf.format(c.target)}</span>{" "}
                      {ch.unit[c.type]} ·{" "}
                      {clients.length === 1 ? ch.coachClientsInOne : fill(ch.coachClientsIn, { count: clients.length })}
                    </p>
                  </div>
                  <ChallengeStatusBadge status={c.status} />
                </div>
                <ul className="divide-y divide-line/60 border-t border-line/60">
                  {clients
                    .slice()
                    .sort((a, b) => b.progress - a.progress)
                    .map((cl) => (
                      <li key={cl.client_id} className="px-5 py-3.5">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="flex min-w-0 items-baseline gap-1.5 text-[14px] font-semibold">
                            <span className="truncate">{cl.name}</span>
                            {cl.completed ? (
                              <NavIcon d={ICON.trophy} className="h-[15px] w-[15px] self-center text-accent-ink" />
                            ) : null}
                          </span>
                          <span className="shrink-0 text-[12.5px] tabular-nums text-ink-faint">
                            <b className="font-display text-[15px] font-extrabold text-ink">{nf.format(cl.progress)}</b> /{" "}
                            {nf.format(c.target)} · {cl.pct}%
                          </span>
                        </div>
                        <div className="mt-2">
                          <ChallengeProgressBar pct={cl.pct} completed={cl.completed} />
                        </div>
                      </li>
                    ))}
                </ul>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** The 24-box icon paths this screen uses. */
const ICON = {
  back: "m15 6-6 6 6 6",
  trophy: "M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4",
} as const;
