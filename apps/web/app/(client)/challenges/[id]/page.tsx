import Link from "next/link";
import { notFound } from "next/navigation";
import { getChallenge } from "@/lib/challenges-data";
import { Card } from "@/components/ui";
import {
  ChallengeMilestones, ChallengeProgressBar, ChallengeStatusBadge, JoinLeaveButton, Leaderboard,
} from "@/components/challenges";
import { challengeSubtitle } from "@/lib/challenge-map";
import { ChallengeDeadline, ChallengeNumbers } from "@/components/challenge-detail";
import { ShareChallenge } from "@/components/share-challenge";
import { fill } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";

export default async function ChallengePage({ params }: { params: Promise<{ id: string }> }) {
  const { t } = await getI18n();
  const { id } = await params;
  const c = await getChallenge(id);
  if (!c) notFound();
  const ch = t.common.challenges;
  const completed = c.status === "completed";

  return (
    // The challenge on the left, its leaderboard beside it once there is room.
    <div className="mx-auto max-w-[1600px]">
      <Link
        href="/challenges"
        className="inline-flex h-9 items-center rounded-full bg-surface px-4 text-[12.5px] font-semibold text-ink-soft hover:text-ink"
      >
        {ch.back}
      </Link>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-extrabold tracking-tight sm:text-[28px]">{c.title}</h1>
        <ChallengeStatusBadge status={c.status} />
      </div>

      <div className="mt-5 grid grid-cols-1 items-start gap-4 sm:mt-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,440px)] xl:gap-6">
        <Card plain>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{challengeSubtitle(c, ch)}</p>
          {c.is_platform ? (
            <p className="mt-1.5 inline-flex rounded-full bg-accent-soft px-2.5 py-0.5 text-[11px] font-semibold text-accent-ink">{ch.platform}</p>
          ) : null}
          {c.description ? <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-soft">{c.description}</p> : null}
          <p className="mt-1.5 text-[12.5px] text-ink-faint">
            {ch.typeHint[c.type]}
            {c.type === "strength_gain" ? ` ${ch.strengthNoBaseline}` : ""}
          </p>

          <div className="mt-4">
            <ChallengeNumbers challenge={c} />
            <div className="mt-2.5">
              <ChallengeProgressBar pct={c.joined ? c.pct : 0} completed={completed} height="h-2.5" />
            </div>
            {c.joined ? (
              <div className="mt-3.5">
                <ChallengeMilestones reached={c.milestones} />
              </div>
            ) : null}
            {completed ? (
              <>
                <p className="mt-3.5 font-display text-lg font-bold tracking-tight text-accent-ink">{ch.completed}</p>
                {c.joined ? <div className="mt-3"><ShareChallenge challengeId={c.id} /></div> : null}
              </>
            ) : !c.joined ? (
              <p className="mt-2.5 text-[12.5px] text-ink-faint">{ch.notJoined}</p>
            ) : null}
          </div>

          <ChallengeDeadline challenge={c} />

          <div className="mt-4">
            <JoinLeaveButton challenge={c} />
          </div>
        </Card>

        {c.leaderboard ? (
          <Leaderboard rows={c.leaderboard} type={c.type} total={c.participants} />
        ) : (
          <p className="text-[12.5px] tabular-nums text-ink-faint">
            {c.participants === 1 ? ch.participantsOne : fill(ch.participants, { count: c.participants })}
          </p>
        )}
      </div>
    </div>
  );
}
