import { getMyChallenges } from "@/lib/challenges-data";
import { EmptyState, PageTitle } from "@/components/ui";
import { ChallengeCard } from "@/components/challenges";
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
    <div>
      <PageTitle title={ch.title} />
      {cards.length === 0 ? (
        <EmptyState title={ch.empty} hint={ch.emptyHint} />
      ) : (
        <div className="space-y-6">
          {groups.map((status) => {
            const items = cards.filter((c) => c.status === status);
            if (items.length === 0) return null;
            return (
              <section key={status}>
                <h2 className="mb-3 text-sm font-bold">
                  {ch.sections[status]} <span className="font-medium text-ink-faint">· {items.length}</span>
                </h2>
                <div className="grid gap-3 lg:grid-cols-2">
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
