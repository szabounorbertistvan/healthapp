import { getMyChallenges } from "@/lib/challenges-data";
import { getMyPrs } from "@/lib/client-data";
import { EmptyState } from "@/components/ui";
import { ChallengeCard } from "@/components/challenges";
import { ChallengeCreate } from "@/components/challenge-create";
import { ChallengeFilters } from "@/components/challenge-filters";
import { getI18n } from "@/lib/i18n/server";
import { matchesChallengeFilter, normalizeChallengeFilter, type ChallengeStatus } from "@healthapp/shared";

/**
 * Every challenge the client can see, grouped by where it stands for them.
 * Progress on each card comes from the database (challenge_cards), and the
 * filters in the URL are applied here, server-side, before anything renders.
 */
export default async function ChallengesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { t } = await getI18n();
  const ch = t.common.challenges;
  const params = await searchParams;
  const one = (key: string) => (Array.isArray(params[key]) ? params[key][0] : params[key]);
  const filter = normalizeChallengeFilter({
    status: one("status"), category: one("category"), difficulty: one("difficulty"),
    duration: one("duration"), q: one("q"),
  });
  // The lifts an exercise challenge can be about: every loaded lift this
  // person has logged (its best set is what exercise_best_sets returns).
  const [all, prs] = await Promise.all([getMyChallenges(), getMyPrs()]);
  const exercises = prs
    .filter((p): p is typeof p & { exercise_id: string } => p.exercise_id !== null)
    .map((p) => ({ id: p.exercise_id, name: p.exercise }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const cards = all.filter((c) => matchesChallengeFilter(c, filter));
  const filtered = cards.length < all.length;
  const groups: ChallengeStatus[] = ["active", "upcoming", "completed", "ended"];

  return (
    // A list of cards: as many columns as fit, never a card under 380px.
    <div className="mx-auto max-w-[1600px]">
      <h1 className="font-display text-2xl font-extrabold tracking-tight sm:text-[28px]">{ch.title}</h1>

      <ChallengeCreate exercises={exercises} />
      {all.length > 0 ? <ChallengeFilters filter={filter} /> : null}
      {cards.length === 0 ? (
        <div className="mt-4">
          {filtered ? <EmptyState title={ch.noResults} hint={ch.emptyHint} /> : <EmptyState title={ch.empty} hint={ch.emptyHint} />}
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
                <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-[repeat(auto-fill,minmax(380px,1fr))] sm:gap-4">
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
