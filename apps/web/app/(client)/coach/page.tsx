import Link from "next/link";
import { isCurrent } from "@healthapp/shared";
import { getMyCoachThread, hasActiveCoach } from "@/lib/client-data";
import { getMessages } from "@/lib/data";
import { getMyCoachingRelationships, getRelationshipHistory, type MyCoachingRelationship } from "@/lib/coaching-data";
import { Card, EmptyState } from "@/components/ui";
import { JoinCoach } from "@/components/join-coach";
import { MessageThread } from "@/components/message-thread";
import { Avatar } from "@/components/social";
import { CoachingActions, RelationshipPill, RelationshipTimeline } from "@/components/coaching-lifecycle";
import { fill } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import { GymCoachesCard } from "@/components/gyms";
import { getGymCoaches, getMyCoachRequests, getMyGyms } from "@/lib/gym-data";

/**
 * /coach — the client's coach (20261109110000): the current one (active or
 * paused) with where things stand and what can be done about it, the
 * conversation, and the past coaches as history — never mixed together.
 * Without a current coach: the ways to find one, as before.
 */
export default async function CoachPage() {
  const [{ t, locale }, relationships] = await Promise.all([getI18n(), getMyCoachingRelationships()]);
  const c = t.coachProfile.coaching;
  const current = relationships.find((r) => isCurrent(r.status)) ?? null;
  const past = relationships.filter((r) => r.status === "ended");
  const date = (iso: string) => new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));

  const pastSection = past.length > 0 ? (
    <section className="mt-6" aria-label={c.past} data-testid="past-coaches">
      <h2 className="font-display text-lg font-bold tracking-tight">{c.past}</h2>
      <p className="mt-1 text-[13px] text-ink-soft">{c.pastHint}</p>
      <ul className="mt-3 grid gap-2">
        {past.map((r) => <PastCoachRow key={r.id} r={r} date={date} />)}
      </ul>
    </section>
  ) : null;

  if (!current) {
    // A database without the lifecycle yet lists nothing; an active coach is still found the old way.
    if (relationships.length === 0 && (await hasActiveCoach())) return <LegacyThread />;
    const [gyms, requests] = await Promise.all([getMyGyms(), getMyCoachRequests()]);
    const coaches = gyms.home ? await getGymCoaches(gyms.home.id) : [];
    return (
      <div className="mx-auto max-w-md">
        <h1 className="font-display text-2xl font-extrabold leading-none tracking-tight sm:text-[28px]">
          {t.common.nav.coach}
        </h1>
        {/* This is the only way in for a client whose account is no longer
            empty: /welcome carries the same form but today/page.tsx stops
            redirecting there once they have a program or picked solo. */}
        <Card plain className="mt-5 space-y-3 sm:mt-6">
          <p className="font-display text-lg font-bold tracking-tight">{t.clientApp.coach.noCoachTitle}</p>
          <p className="text-[13.5px] leading-relaxed text-ink-soft">{t.clientApp.welcome.withCoachBody}</p>
          <JoinCoach autoFocus={false} />
          {/* no invite code: the way into the directory (20261108100000) */}
          <Link href="/coaches" data-testid="find-a-coach"
            className="inline-flex h-11 items-center rounded-2xl bg-bg px-5 text-sm font-semibold text-ink hover:bg-accent-soft/60">
            {t.coachProfile.saved.emptyCta} →
          </Link>
        </Card>
        <div className="mt-3.5">
          <GymCoachesCard gym={gyms.home ? { id: gyms.home.id, name: gyms.home.name } : null} coaches={coaches} requests={requests} />
        </div>
        {pastSection}
      </div>
    );
  }

  const [messages, history] = await Promise.all([
    current.conversation_id ? getMessages(current.conversation_id) : Promise.resolve([]),
    getRelationshipHistory(current.id),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col">
      <section className="rounded-3xl bg-surface p-5" data-testid="current-coach" data-status={current.status}>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{c.current}</p>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar name={current.coach_name} url={current.coach_avatar} size="h-12 w-12" />
            <div className="min-w-0">
              <h1 className="truncate font-display text-2xl font-extrabold leading-tight tracking-tight">{current.coach_name}</h1>
              <p className="text-[12.5px] text-ink-faint">
                {fill(c.since, { date: date(current.started_at) })}
                {current.status === "paused" && current.paused_at ? ` · ${fill(c.pausedSince, { date: date(current.paused_at) })}` : ""}
              </p>
            </div>
          </div>
          <RelationshipPill status={current.status} />
        </div>
        {current.status === "paused" ? (
          <p className="mt-3 rounded-2xl bg-warn-soft px-3.5 py-2.5 text-[13px] text-warn">
            {c.pausedNote}{" "}
            {current.paused_by_me ? c.pausedByYou : fill(c.pausedByOther, { name: current.coach_name })}
            {current.pause_reason ? ` · ${(c.pauseReasons as Record<string, string>)[current.pause_reason]}` : ""}
          </p>
        ) : null}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {current.coach_slug ? (
            <Link href={`/coaches/${current.coach_slug}`} className="inline-flex h-9 items-center rounded-xl bg-bg px-3.5 text-[13px] font-semibold text-ink hover:bg-accent-soft/60">
              {c.book}
            </Link>
          ) : null}
          <CoachingActions relationshipId={current.id} status={current.status} otherName={current.coach_name} />
        </div>
        {history.length > 1 ? (
          <details className="mt-4">
            <summary className="cursor-pointer text-[13px] font-semibold text-ink-soft">{c.history}</summary>
            <div className="mt-3"><RelationshipTimeline events={history} otherName={current.coach_name} /></div>
          </details>
        ) : null}
      </section>

      <div className="mt-4 flex min-h-[50vh] flex-col">
        {current.conversation_id ? (
          <MessageThread conversationId={current.conversation_id} initialMessages={messages} />
        ) : (
          <EmptyState plain title={t.clientApp.coach.noMessagesTitle} hint={t.clientApp.coach.noMessagesHint} />
        )}
      </div>
      {pastSection}
    </div>
  );
}

async function PastCoachRow({ r, date }: { r: MyCoachingRelationship; date: (iso: string) => string }) {
  const { t } = await getI18n();
  const c = t.coachProfile.coaching;
  return (
    <li className="rounded-2xl bg-surface p-4" data-testid="past-coach">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={r.coach_name} url={r.coach_avatar} size="h-10 w-10" />
          <div className="min-w-0">
            <p className="truncate font-semibold">{r.coach_name}</p>
            <p className="text-[12.5px] text-ink-faint">
              {fill(c.period, { from: date(r.started_at), to: r.ended_at ? date(r.ended_at) : "—" })}
              {r.end_reason ? ` · ${(c.endReasons as Record<string, string>)[r.end_reason]}` : ""}
            </p>
          </div>
        </div>
        <RelationshipPill status={r.status} />
      </div>
      <p className="mt-2 text-[12.5px] text-ink-soft">
        {fill(c.completedSessions, { n: r.completed_bookings })}
        {r.my_review ? ` · ${fill(c.yourReview, { rating: r.my_review.rating })}` : ""}
      </p>
      <div className="mt-3 flex flex-wrap gap-2 text-[13px]">
        {r.conversation_id ? <Link href={`/coach/messages/${r.conversation_id}`} className="font-semibold text-accent-ink hover:underline">{c.message}</Link> : null}
        {r.coach_slug && !r.my_review ? <Link href={`/coaches/${r.coach_slug}/review`} className="font-semibold text-accent-ink hover:underline">{c.review}</Link> : null}
        {r.coach_slug ? <Link href={`/coaches/${r.coach_slug}`} className="font-semibold text-accent-ink hover:underline" data-testid="start-new-coaching">{c.startNew}</Link> : null}
      </div>
    </li>
  );
}

/** Before the lifecycle reached the database: the active coach's thread, as it always was. */
async function LegacyThread() {
  const { t } = await getI18n();
  const thread = await getMyCoachThread();
  if (!thread) {
    return (
      <div className="mx-auto max-w-3xl">
        <h1 className="font-display text-2xl font-extrabold leading-none tracking-tight sm:text-[28px]">{t.common.nav.coach}</h1>
        <div className="mt-5 sm:mt-6">
          <EmptyState plain title={t.clientApp.coach.noMessagesTitle} hint={t.clientApp.coach.noMessagesHint} />
        </div>
      </div>
    );
  }
  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col">
      <h1 className="mb-4 font-display text-2xl font-extrabold leading-none tracking-tight sm:text-[28px]">{thread.coach_name}</h1>
      <MessageThread conversationId={thread.id} initialMessages={thread.messages} />
    </div>
  );
}
