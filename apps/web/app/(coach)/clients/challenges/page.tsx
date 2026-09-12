import Link from "next/link";
import { getCoachChallenges } from "@/lib/challenges-data";
import { Card, EmptyState, PageTitle } from "@/components/ui";
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
    <div>
      <Link href="/clients" className="text-xs font-semibold text-ink-faint hover:text-accent-ink">
        ← {t.common.nav.clients}
      </Link>
      <div className="mt-3">
        <PageTitle title={ch.coachTitle} />
      </div>
      {rows.length === 0 ? (
        <EmptyState title={ch.coachEmpty} hint={ch.emptyHint} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {rows.map(({ challenge: c, clients }) => (
            <Card key={c.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-bold">{c.title}</p>
                  <p className="mt-0.5 text-xs text-ink-faint">
                    {ch.type[c.type]} · {ch.target}: {nf.format(c.target)} {ch.unit[c.type]} ·{" "}
                    {clients.length === 1 ? ch.coachClientsInOne : fill(ch.coachClientsIn, { count: clients.length })}
                  </p>
                </div>
                <ChallengeStatusBadge status={c.status} />
              </div>
              <ul className="mt-4 space-y-3">
                {clients
                  .slice()
                  .sort((a, b) => b.progress - a.progress)
                  .map((cl) => (
                    <li key={cl.client_id}>
                      <div className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="min-w-0 truncate font-semibold">
                          {cl.name}
                          {cl.completed ? <span className="ml-1.5 text-xs text-accent-ink">🏆</span> : null}
                        </span>
                        <span className="shrink-0 text-xs tabular-nums text-ink-soft">
                          <b className="text-ink">{nf.format(cl.progress)}</b> / {nf.format(c.target)} · {cl.pct}%
                        </span>
                      </div>
                      <div className="mt-1">
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
  );
}
