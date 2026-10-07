import Link from "next/link";
import { fill } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import type { CoachClientRelationship } from "@/lib/coaching-data";
import { Avatar } from "./social";
import { RelationshipPill } from "./coaching-lifecycle";

/**
 * The coach's paused and past clients (20261109110000), under the active
 * roster on /clients. Each row opens the relationship's own page
 * (/clients/relationship/[id]) — its history and what can still be done —
 * never the active client page, so a past client is not treated as current.
 */
export async function CoachRelationshipSection({ kind, rows }: { kind: "paused" | "past"; rows: CoachClientRelationship[] }) {
  if (rows.length === 0) return null;
  const { t, locale } = await getI18n();
  const c = t.coachProfile.coaching;
  const date = (iso: string) => new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
  return (
    <section className="mt-6" aria-label={kind === "paused" ? c.clients.paused : c.clients.past} data-testid={`clients-${kind}`}>
      <h2 className="font-display text-lg font-bold tracking-tight">{kind === "paused" ? c.clients.paused : c.clients.past}</h2>
      <p className="mt-1 text-[13px] text-ink-soft">{kind === "paused" ? c.clients.pausedHint : c.clients.pastHint}</p>
      <ul className="mt-3 grid gap-2">
        {rows.map((r) => (
          <li key={r.id}>
            <Link href={`/clients/relationship/${r.id}`} data-testid="client-relationship"
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-surface p-4 hover:bg-accent-soft/40">
              <span className="flex min-w-0 items-center gap-3">
                <Avatar name={r.client_name} url={r.client_avatar} size="h-10 w-10" />
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{r.client_name}</span>
                  <span className="block text-[12.5px] text-ink-faint">
                    {r.status === "paused" && r.paused_at
                      ? fill(c.pausedSince, { date: date(r.paused_at) })
                      : fill(c.period, { from: date(r.started_at), to: r.ended_at ? date(r.ended_at) : "—" })}
                    {r.next_booking_at ? ` · ${fill(c.clients.nextSession, { date: date(r.next_booking_at) })}` : ""}
                  </span>
                </span>
              </span>
              <RelationshipPill status={r.status} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
