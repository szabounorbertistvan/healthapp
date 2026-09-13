import Link from "next/link";
import { exerciseFacets } from "@/lib/exercise-library";
import { Card, PageTitle } from "@/components/ui";
import { ExercisePicker } from "@/components/exercise-picker";
import { fill } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";

/**
 * The exercise library for a client — the same picker the coach's /library
 * page uses, browse-only plus "create exercise". A custom exercise lands in
 * `exercises` with owner_id = the client (policy exercises_owner_write), so
 * it is theirs and shows up first in the program builder's picker.
 */
export default async function ClientExercisesPage() {
  const { t } = await getI18n();
  const facets = exerciseFacets();
  const l = t.clientApp.library;

  return (
    <div>
      <PageTitle title={l.title}>
        <Link href="/workout/build" className="text-xs font-semibold text-accent-ink hover:underline">
          {t.clientApp.builder.title}
        </Link>
      </PageTitle>
      <p className="mb-3 text-sm text-ink-soft">{l.hint}</p>

      <Card className="flex h-[calc(100vh-14rem)] flex-col">
        <ExercisePicker muscles={facets.muscles} equipment={facets.equipment} />
      </Card>

      <p className="mt-3 text-xs text-ink-faint">
        {fill(l.facets, { muscles: facets.muscles.length, equipment: facets.equipment.length })} · {l.source}
      </p>
    </div>
  );
}
