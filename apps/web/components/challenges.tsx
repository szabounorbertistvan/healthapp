"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ChallengeStatus } from "@healthapp/shared";
import { deleteChallenge, joinChallenge, leaveChallenge } from "@/app/challenge-actions";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { parseDay } from "@/lib/week";
import type { ChallengeCard as ChallengeCardRow, LeaderboardRow } from "@/lib/types";
import { NavIcon } from "./client-nav";
import { Card } from "./ui";

const CHEVRON = "m9 6 6 6-6 6";
const CLOCK = "M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18M12 7v5l3 2";
const PEOPLE = "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M2 20a7 7 0 0 1 14 0M17 11a3 3 0 0 0 0-6M18 20h4a6 6 0 0 0-3-5.2";

/** One 24-box icon per challenge type — what the challenge counts. */
const TYPE_ICON: Record<ChallengeCardRow["type"], string> = {
  workouts: "M2 10v4M22 10v4M5 8v8M19 8v8M8 6v12M16 6v12M8 12h8",
  training_load: "M4 18a8 8 0 1 1 16 0M12 18l4-5",
  volume: "M4 19h16M7 19V9M12 19V5M17 19v-6",
  active_days: "M8 3v3M16 3v3M5 6h14v14H5zM4 10h16M9 15l2 2 4-4",
};

const STATUS_TONE: Record<ChallengeStatus, string> = {
  active: "bg-accent-soft text-accent-ink",
  upcoming: "bg-bg text-ink-soft",
  completed: "bg-accent text-accent-fg",
  ended: "bg-bg text-ink-faint",
};

export function ChallengeStatusBadge({ status }: { status: ChallengeStatus }) {
  const { t } = useI18n();
  return (
    <span className={`inline-block shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold ${STATUS_TONE[status]}`}>
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
    <Link href={`/challenges/${c.id}`} className="block h-full">
      <Card plain className="flex h-full flex-col transition hover:bg-accent-soft/40">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <NavIcon d={TYPE_ICON[c.type]} className="h-11 w-11 shrink-0 text-accent-ink" />
            <div className="min-w-0">
              <h3 className="truncate font-display text-lg font-bold tracking-tight">{c.title}</h3>
              <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{ch.type[c.type]}</p>
            </div>
          </div>
          <ChallengeStatusBadge status={c.status} />
        </div>
        {c.description ? <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">{c.description}</p> : null}
        <div className="mt-3.5">
          <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
            <span className="tabular-nums">
              {c.joined ? (
                <>
                  <b className="font-display text-base font-extrabold text-ink">{n(c.progress)}</b>
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
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[12.5px] text-ink-faint">
          <span className="flex items-center gap-1.5">
            <NavIcon d={CLOCK} className="h-[18px] w-[18px] text-accent-ink" />
            {deadlineText(c, t, date)}
          </span>
          <span className="flex items-center gap-1.5 tabular-nums">
            <NavIcon d={PEOPLE} className="h-[18px] w-[18px] text-accent-ink" />
            {c.participants === 1 ? ch.participantsOne : fill(ch.participants, { count: c.participants })}
          </span>
        </div>
        <div className="mt-auto flex items-center justify-between gap-3 pt-3.5">
          {completed ? (
            <p className="text-[13px] font-semibold text-accent-ink">{ch.completed}</p>
          ) : (
            <span />
          )}
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent-ink" aria-hidden>
            <NavIcon d={CHEVRON} className="h-3.5 w-3.5 [stroke-width:2.2]" />
          </span>
        </div>
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

  // Deleting is offered on your own challenge only, and beside leaving rather
  // than instead of it: the creator is a participant too.
  const ownerControls = c.mine ? (
    <button
      type="button"
      disabled={pending}
      onClick={() => run(() => deleteChallenge(c.id))}
      className="text-[12.5px] font-semibold text-ink-faint hover:text-risk disabled:opacity-50"
    >
      {ch.deleteChallenge}
    </button>
  ) : null;

  if (c.joined) {
    return (
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => leaveChallenge(c.id))}
            className="flex h-11 items-center justify-center rounded-2xl bg-bg px-5 text-sm font-semibold text-ink-soft hover:text-risk disabled:opacity-50"
          >
            {ch.leave}
          </button>
          {ownerControls}
        </div>
        {error ? <p className="mt-2 text-xs text-risk">{error}</p> : null}
      </div>
    );
  }
  if (!c.can_join) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-[13px] text-ink-faint">{ch.endedCannotJoin}</p>
        {ownerControls}
      </div>
    );
  }
  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() => run(() => joinChallenge(c.id))}
        className="flex h-11 w-full items-center justify-center rounded-2xl bg-accent px-5 font-display text-sm font-bold text-accent-fg hover:opacity-90 disabled:opacity-50 sm:w-auto"
      >
        {ch.join}
      </button>
      {ownerControls ? <div className="mt-2">{ownerControls}</div> : null}
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
    <Card plain className="overflow-hidden p-0">
      <div className="flex items-baseline justify-between gap-3 px-5 pb-3 pt-[18px]">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{ch.leaderboard}</p>
        {mine ? (
          <p className="text-[12.5px] tabular-nums text-ink-soft">{fill(ch.yourRank, { rank: mine.rank, total: rows.length })}</p>
        ) : null}
      </div>
      <ol className="divide-y divide-line/60 border-t border-line/60">
        {rows.map((r) => (
          <li
            key={r.user_id}
            className={`flex min-h-12 items-center gap-3 px-5 py-3 text-[14px] ${r.me ? "bg-accent-soft" : ""}`}
          >
            <span className={`w-7 shrink-0 tabular-nums ${r.rank <= 3 ? "font-bold text-accent-ink" : "text-ink-faint"}`}>
              #{r.rank}
            </span>
            <span className="min-w-0 flex-1 truncate font-semibold">
              {r.name}
              {r.me ? <span className="ml-1.5 text-[11px] font-semibold uppercase tracking-wider text-accent-ink">{ch.you}</span> : null}
            </span>
            <span className="shrink-0 tabular-nums text-ink-faint">
              <b className="font-display text-[15px] font-bold text-ink">{n(r.value)}</b> {unit(type)}
            </span>
          </li>
        ))}
      </ol>
    </Card>
  );
}
