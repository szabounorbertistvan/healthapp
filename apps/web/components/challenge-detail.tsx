"use client";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import type { ChallengeCard } from "@/lib/types";
import { deadlineText, useChallengeFormat } from "./challenges";

/** "318 / 500 points · 64%" — the big numbers on the detail page. */
export function ChallengeNumbers({ challenge: c }: { challenge: ChallengeCard }) {
  const { t } = useI18n();
  const { n, unit } = useChallengeFormat();
  const ch = t.common.challenges;
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <p className="tabular-nums">
        <span className="text-3xl font-bold">{c.joined ? n(c.progress) : "—"}</span>
        <span className="text-sm text-ink-faint">
          {" "}/ {n(c.target)} {unit(c.type)}
        </span>
      </p>
      <p className="text-sm text-ink-soft">
        <span className="text-xs uppercase tracking-wider text-ink-faint">{ch.progress}</span>{" "}
        <b className="text-lg tabular-nums text-ink">{c.joined ? c.pct : 0}%</b>
      </p>
    </div>
  );
}

/** Start – end, days remaining, participant count. */
export function ChallengeDeadline({ challenge: c }: { challenge: ChallengeCard }) {
  const { t } = useI18n();
  const { date } = useChallengeFormat();
  const ch = t.common.challenges;
  return (
    <dl className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
      <div>
        <dt className="text-ink-faint">{ch.periodLabel}</dt>
        <dd className="mt-0.5 font-semibold tabular-nums">{fill(ch.period, { start: date(c.start_date), end: date(c.end_date) })}</dd>
      </div>
      <div>
        <dt className="text-ink-faint">{ch.status[c.status]}</dt>
        <dd className="mt-0.5 font-semibold">{deadlineText(c, t, date)}</dd>
      </div>
      <div>
        <dt className="text-ink-faint">{ch.participantsLabel}</dt>
        <dd className="mt-0.5 font-semibold tabular-nums">
          {c.participants === 1 ? ch.participantsOne : fill(ch.participants, { count: c.participants })}
        </dd>
      </div>
      {c.joined ? (
        <div>
          <dt className="text-ink-faint">{ch.joined}</dt>
          <dd className="mt-0.5 font-semibold text-accent-ink">✓</dd>
        </div>
      ) : null}
    </dl>
  );
}
