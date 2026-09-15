import Link from "next/link";
import { exerciseFacets } from "@/lib/exercise-library";
import { Card } from "@/components/ui";
import { NavIcon } from "@/components/client-nav";
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
    <div className="mx-auto max-w-[1600px]">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-extrabold leading-none tracking-tight sm:text-[28px]">{l.title}</h1>
          <p className="mt-2 text-[13px] text-ink-faint">{l.hint}</p>
        </div>
        <Link
          href="/workout/build"
          className="inline-flex h-9 items-center gap-2 rounded-full bg-surface px-3.5 text-xs font-semibold text-ink-soft hover:text-ink sm:h-10 sm:px-4 sm:text-[13px]"
        >
          <NavIcon d="M12 5v14M5 12h14" className="h-[17px] w-[17px]" />
          {t.clientApp.builder.title}
        </Link>
      </div>

      {/* One tall card that scrolls inside itself: the search, the filters and
          the count stay put while 873 exercises move underneath them. */}
      <Card plain className="mt-5 flex h-[calc(100vh-15rem)] min-h-[24rem] flex-col sm:mt-6 sm:p-5">
        <ExercisePicker muscles={facets.muscles} equipment={facets.equipment} />
      </Card>

      <p className="mt-3 text-[12.5px] text-ink-faint">
        {fill(l.facets, { muscles: facets.muscles.length, equipment: facets.equipment.length })} · {l.source}
      </p>
    </div>
  );
}
