import Link from "next/link";
import { notFound } from "next/navigation";
import { getChallenge } from "@/lib/challenges-data";
import { Card, PageTitle } from "@/components/ui";
import {
  ChallengeProgressBar, ChallengeStatusBadge, JoinLeaveButton, Leaderboard,
} from "@/components/challenges";
import { ChallengeDeadline, ChallengeNumbers } from "@/components/challenge-detail";
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
    <div className="space-y-4">
      <Link href="/challenges" className="text-xs font-semibold text-ink-faint hover:text-accent-ink">
        {ch.back}
      </Link>
      <PageTitle title={c.title}>
        <ChallengeStatusBadge status={c.status} />
      </PageTitle>

      <Card>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{ch.type[c.type]}</p>
        {c.description ? <p className="mt-1 text-sm text-ink-soft">{c.description}</p> : null}

        <div className="mt-4">
          <ChallengeNumbers challenge={c} />
          <div className="mt-2">
            <ChallengeProgressBar pct={c.joined ? c.pct : 0} completed={completed} height="h-3" />
          </div>
          {completed ? (
            <p className="mt-3 text-base font-bold text-accent-ink">{ch.completed}</p>
          ) : !c.joined ? (
            <p className="mt-2 text-xs text-ink-faint">{ch.notJoined}</p>
          ) : null}
        </div>

        <ChallengeDeadline challenge={c} />

        <div className="mt-4">
          <JoinLeaveButton challenge={c} />
        </div>
      </Card>

      {c.leaderboard ? (
        <Leaderboard rows={c.leaderboard} type={c.type} />
      ) : (
        <p className="text-xs text-ink-faint">
          {c.participants === 1 ? ch.participantsOne : fill(ch.participants, { count: c.participants })}
        </p>
      )}
    </div>
  );
}
