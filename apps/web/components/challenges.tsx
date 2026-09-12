"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ChallengeStatus } from "@healthapp/shared";
import { joinChallenge, leaveChallenge } from "@/app/challenge-actions";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { parseDay } from "@/lib/week";
import type { ChallengeCard as ChallengeCardRow, LeaderboardRow } from "@/lib/types";
import { Card } from "./ui";

const STATUS_TONE: Record<ChallengeStatus, string> = {
  active: "bg-accent-soft text-accent-ink",
  upcoming: "bg-bg text-ink-soft",
  completed: "bg-accent text-accent-fg",
  ended: "bg-bg text-ink-faint",
};

export function ChallengeStatusBadge({ status }: { status: ChallengeStatus }) {
  const { t } = useI18n();
  return (
    <span className={`inline-block whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-semibold ${STATUS_TONE[status]}`}>
      {t.common.challenges.status[status]}
    </span>
  );
}

/** "318 / 500" in the challenge's unit, locale-formatted. */
export function useChallengeFormat() {
  const { t, locale } = useI18n();
  const nf = new Intl.NumberFormat(locale === "ro" ? "ro-RO" : "en-GB");
  const df = new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", { day: "numeric", month: "short" });
  return {
    n: (v: number) => nf.format(v),
    date: (day: string) => df.format(parseDay(day)),
    unit: (type: ChallengeCardRow["type"]) => t.common.challenges.unit[type],
  };
}

/** The bar every surface shares — full and gold once complete. */
export function ChallengeProgressBar({ pct, completed, height = "h-2" }: { pct: number; completed: boolean; height?: string }) {
  return (
    <div className={`${height} overflow-hidden rounded-full bg-bg`}>
      <div
        className={`h-full rounded-full ${completed ? "bg-accent" : pct >= 50 ? "bg-accent" : "bg-ink-soft"}`}
        style={{ width: `${Math.min(100, pct)}%` }}
      />
    </div>
  );
}

/** What the deadline line says, from the card's status. */
export function deadlineText(c: ChallengeCardRow, t: ReturnType<typeof useI18n>["t"], date: (d: string) => string): string {
  const ch = t.common.challenges;
  if (c.status === "upcoming") {
    const days = Math.max(1, Math.round((parseDay(c.start_date).getTime() - Date.now()) / 86_400_000));
    return days === 1 ? ch.startsTomorrow : fill(ch.startsIn, { days });
  }
  if (c.status === "ended") return fill(ch.endedOn, { date: date(c.end_date) });
  if (c.status === "completed" && c.completed_at) return fill(ch.completedOn, { date: date(c.completed_at.slice(0, 10)) });
  return c.days_remaining === 1 ? ch.oneDayRemaining : fill(ch.daysRemaining, { days: c.days_remaining });
}

export function ChallengeCard({ challenge: c }: { challenge: ChallengeCardRow }) {
  const { t } = useI18n();
  const { n, date, unit } = useChallengeFormat();
  const ch = t.common.challenges;
  const completed = c.status === "completed";
  return (
    <Link href={`/challenges/${c.id}`} className="block">
      <Card className="hover:border-accent">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-bold">{c.title}</p>
            <p className="mt-0.5 text-xs text-ink-faint">{ch.type[c.type]}</p>
          </div>
          <ChallengeStatusBadge status={c.status} />
        </div>
        {c.description ? <p className="mt-2 text-sm text-ink-soft">{c.description}</p> : null}
        <div className="mt-3">
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <span className="tabular-nums">
              {c.joined ? (
                <>
                  <b className="text-ink">{n(c.progress)}</b>
                  <span className="text-ink-faint"> / {n(c.target)} {unit(c.type)}</span>
                </>
              ) : (
                <span className="text-ink-faint">
                  {ch.target}: {n(c.target)} {unit(c.type)}
                </span>
              )}
            </span>
            {c.joined ? <span className="font-semibold tabular-nums text-ink-soft">{c.pct}%</span> : null}
          </div>
          <div className="mt-1.5">
            <ChallengeProgressBar pct={c.joined ? c.pct : 0} completed={completed} />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-ink-faint">
          <span>{deadlineText(c, t, date)}</span>
          <span className="tabular-nums">
            {c.participants === 1 ? ch.participantsOne : fill(ch.participants, { count: c.participants })}
          </span>
        </div>
        {completed ? <p className="mt-3 text-sm font-semibold text-accent-ink">{ch.completed}</p> : null}
      </Card>
    </Link>
  );
}

/** Join / leave. Ended challenges cannot be joined; leaving is always allowed. */
export function JoinLeaveButton({ challenge: c }: { challenge: ChallengeCardRow }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const ch = t.common.challenges;

  function run(action: () => Promise<{ ok: boolean; message?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setError(result.message ?? "Error");
      router.refresh();
    });
  }

  if (c.joined) {
    return (
      <div>
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => leaveChallenge(c.id))}
          className="w-full rounded-lg border border-line px-4 py-3 text-sm font-semibold text-ink-soft hover:border-risk hover:text-risk disabled:opacity-50 sm:w-auto"
        >
          {ch.leave}
        </button>
        {error ? <p className="mt-2 text-xs text-risk">{error}</p> : null}
      </div>
    );
  }
  if (!c.can_join) {
    return <p className="text-sm text-ink-faint">{ch.endedCannotJoin}</p>;
  }
  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() => run(() => joinChallenge(c.id))}
        className="w-full rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-accent-fg hover:opacity-90 disabled:opacity-50 sm:w-auto"
      >
        {ch.join}
      </button>
      {error ? <p className="mt-2 text-xs text-risk">{error}</p> : null}
    </div>
  );
}

export function Leaderboard({ rows, type }: { rows: LeaderboardRow[]; type: ChallengeCardRow["type"] }) {
  const { t } = useI18n();
  const { n, unit } = useChallengeFormat();
  const ch = t.common.challenges;
  const mine = rows.find((r) => r.me);
  return (
    <Card className="p-0">
      <div className="flex items-baseline justify-between gap-3 border-b border-line px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{ch.leaderboard}</p>
        {mine ? (
          <p className="text-xs tabular-nums text-ink-soft">{fill(ch.yourRank, { rank: mine.rank, total: rows.length })}</p>
        ) : null}
      </div>
      <ol>
        {rows.map((r) => (
          <li
            key={r.user_id}
            className={`flex items-center gap-3 border-b border-line px-4 py-2.5 text-sm last:border-0 ${r.me ? "bg-accent-soft" : ""}`}
          >
            <span className={`w-7 shrink-0 tabular-nums ${r.rank <= 3 ? "font-bold text-accent-ink" : "text-ink-faint"}`}>
              #{r.rank}
            </span>
            <span className="min-w-0 flex-1 truncate font-semibold">
              {r.name}
              {r.me ? <span className="ml-1.5 text-xs font-medium text-accent-ink">({ch.you})</span> : null}
            </span>
            <span className="shrink-0 tabular-nums text-ink-soft">
              <b className="text-ink">{n(r.value)}</b> {unit(type)}
            </span>
          </li>
        ))}
      </ol>
    </Card>
  );
}
