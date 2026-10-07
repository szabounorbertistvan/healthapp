import Link from "next/link";
import { notFound } from "next/navigation";
import { getI18n } from "@/lib/i18n/server";
import { fill } from "@/lib/i18n";
import { getCoachClientRelationships, getRelationshipHistory } from "@/lib/coaching-data";
import { Avatar } from "@/components/social";
import { CoachingActions, RelationshipPill, RelationshipTimeline } from "@/components/coaching-lifecycle";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * /clients/relationship/[id] — one coaching relationship from the coach's side
 * (20261109110000): where it stands, its history, the sessions it had, the
 * conversation, and the moves still possible. For a paused or past client
 * this is the page — their training data stays behind is_active_coach_of(),
 * so nothing of it is read here. An active one links on to the client page.
 */
export default async function CoachRelationshipPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const [{ t, locale }, all, history] = await Promise.all([getI18n(), getCoachClientRelationships("all"), getRelationshipHistory(id)]);
  const r = all.find((x) => x.id === id);
  if (!r) notFound();
  const c = t.coachProfile.coaching;
  const date = (iso: string) => new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/clients" className="text-[13px] font-semibold text-ink-faint hover:text-ink">← {c.relationship.back}</Link>
      <section className="mt-3 rounded-3xl bg-surface p-5" data-testid="coach-relationship" data-status={r.status}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar name={r.client_name} url={r.client_avatar} size="h-12 w-12" />
            <div className="min-w-0">
              <h1 className="truncate font-display text-2xl font-extrabold tracking-tight">{fill(c.relationship.title, { name: r.client_name })}</h1>
              <p className="text-[12.5px] text-ink-faint">
                {r.status === "ended" && r.ended_at
                  ? fill(c.period, { from: date(r.started_at), to: date(r.ended_at) })
                  : fill(c.since, { date: date(r.started_at) })}
              </p>
            </div>
          </div>
          <RelationshipPill status={r.status} />
        </div>
        {r.status === "ended" ? <p className="mt-3 text-[13px] text-ink-soft">{c.relationship.historyOnly}</p> : null}
        {r.status === "paused" ? <p className="mt-3 text-[13px] text-warn">{c.relationship.pausedOnly}</p> : null}
        {r.status === "paused" ? (
          <p className="mt-1 text-[12.5px] text-ink-faint">
            {r.paused_by_me ? c.pausedByYou : fill(c.pausedByOther, { name: r.client_name })}
            {r.pause_reason ? ` · ${(c.pauseReasons as Record<string, string>)[r.pause_reason]}` : ""}
          </p>
        ) : null}
        {r.status === "ended" ? (
          <p className="mt-1 text-[12.5px] text-ink-faint">
            {r.ended_by_me ? c.endedByYou : r.ended_by_me === false ? fill(c.endedByOther, { name: r.client_name }) : ""}
            {r.end_reason ? ` · ${(c.endReasons as Record<string, string>)[r.end_reason]}` : ""}
          </p>
        ) : null}
        <p className="mt-3 text-[13px] text-ink-soft">
          {fill(c.completedSessions, { n: r.completed_bookings })}
          {r.next_booking_at ? ` · ${fill(c.clients.nextSession, { date: date(r.next_booking_at) })}` : ""}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {r.status === "active" ? (
            <Link href={`/clients/${r.client_id}`} className="inline-flex h-9 items-center rounded-xl bg-accent px-3.5 text-[13px] font-bold text-accent-fg hover:opacity-90">
              {c.relationship.openClient}
            </Link>
          ) : null}
          {r.conversation_id ? (
            <Link href={`/messages/${r.conversation_id}`} className="inline-flex h-9 items-center rounded-xl bg-bg px-3.5 text-[13px] font-semibold text-ink hover:bg-accent-soft/60">
              {c.message}
            </Link>
          ) : null}
          <CoachingActions relationshipId={r.id} status={r.status} otherName={r.client_name} />
        </div>
      </section>

      <section className="mt-4 rounded-3xl bg-surface p-5" aria-label={c.history}>
        <h2 className="font-display text-lg font-bold tracking-tight">{c.history}</h2>
        <div className="mt-3"><RelationshipTimeline events={history} otherName={r.client_name} /></div>
      </section>
    </div>
  );
}
