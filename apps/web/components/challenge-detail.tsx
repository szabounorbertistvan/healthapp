"use client";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import type { ChallengeCard } from "@/lib/types";
import { NavIcon } from "./client-nav";
import { deadlineText, useChallengeFormat } from "./challenges";

const CHECK = "m5 12 5 5 9-10";

/** "318 / 500 points · 64%" — the big numbers on the detail page. */
export function ChallengeNumbers({ challenge: c }: { challenge: ChallengeCard }) {
  const { t } = useI18n();
  const { n, pct, unit } = useChallengeFormat();
  const ch = t.common.challenges;
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <p>
        <span className="font-display text-[34px] font-extrabold tabular-nums leading-none">{c.joined ? n(c.progress) : "—"}</span>
        <span className="ml-1.5 font-sans text-[13px] font-medium text-ink-faint">
          / {n(c.target)} {unit(c.type)}
        </span>
      </p>
      <p className="text-right">
        <span className="block text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{ch.progress}</span>
        <b className="font-display text-xl font-extrabold tabular-nums leading-none">{pct(c.joined ? c.pct : 0)}</b>
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
    <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Fact label={ch.periodLabel}>
        <span className="tabular-nums">{fill(ch.period, { start: date(c.start_date), end: date(c.end_date) })}</span>
      </Fact>
      <Fact label={ch.status[c.status]}>{deadlineText(c, t, date)}</Fact>
      <Fact label={ch.participantsLabel}>
        <span className="tabular-nums">
          {c.participants === 1 ? ch.participantsOne : fill(ch.participants, { count: c.participants })}
        </span>
      </Fact>
      {c.joined ? (
        <Fact label={ch.joined}>
          <NavIcon d={CHECK} className="h-4 w-4 text-accent-ink [stroke-width:2.4]" />
        </Fact>
      ) : null}
    </dl>
  );
}

/** One label / value block on the bg tone, the way a nested block sits in a card. */
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-bg px-3.5 py-3">
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{label}</dt>
      <dd className="mt-1 flex items-center text-[13px] font-semibold">{children}</dd>
    </div>
  );
}
