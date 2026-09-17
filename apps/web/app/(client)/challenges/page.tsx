import { getMyChallenges } from "@/lib/challenges-data";
import { EmptyState } from "@/components/ui";
import { ChallengeCard } from "@/components/challenges";
import { ChallengeCreate } from "@/components/challenge-create";
import { getI18n } from "@/lib/i18n/server";
import type { ChallengeStatus } from "@healthapp/shared";

/**
 * Every challenge the client can see, grouped by where it stands for them.
 * Progress on each card is derived at read time — see lib/challenges-data.ts.
 */
export default async function ChallengesPage() {
  const { t } = await getI18n();
  const ch = t.common.challenges;
  const cards = await getMyChallenges();
  const groups: ChallengeStatus[] = ["active", "upcoming", "completed", "ended"];

  return (
    // A list of cards: as many columns as fit, never a card under 380px.
    <div className="mx-auto max-w-[1600px]">
      <h1 className="font-display text-2xl font-extrabold tracking-tight sm:text-[28px]">{ch.title}</h1>

      <ChallengeCreate />
      {cards.length === 0 ? (
        <div className="mt-4">
          <EmptyState title={ch.empty} hint={ch.emptyHint} />
        </div>
      ) : (
        <div className="mt-4 space-y-6">
          {groups.map((status) => {
            const items = cards.filter((c) => c.status === status);
            if (items.length === 0) return null;
            return (
              <section key={status}>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <h2 className="text-xs font-bold uppercase tracking-[0.06em] text-ink-soft">{ch.sections[status]}</h2>
                  <span className="rounded-full bg-surface px-2.5 py-1 text-[11px] font-semibold tabular-nums text-ink-faint">
                    {items.length}
                  </span>
                </div>
                <div className="grid items-start gap-3 sm:grid-cols-[repeat(auto-fill,minmax(380px,1fr))] sm:gap-4">
                  {items.map((c) => (
                    <ChallengeCard key={c.id} challenge={c} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
