import { exerciseFacets } from "@/lib/exercise-library";
import { Card } from "@/components/ui";
import { ExercisePicker } from "@/components/exercise-picker";
import { fill } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";

// W5 · Exercise library. The system library is the Free Exercise DB (873
// exercises, public domain), seeded into supabase/seed/exercises.json and
// upserted into `exercises` by the import-exercises function. Romanian names
// are still empty — the plan asks for the top ~200 translated before beta.
export default async function LibraryPage() {
  const { t } = await getI18n();
  const facets = exerciseFacets();
  const l = t.coachApp.library;

  return (
    <div className="mx-auto max-w-[1600px]">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-display text-2xl font-extrabold leading-none tracking-tight sm:text-[28px]">
          {l.title}
        </h1>
        <p className="text-[12.5px] text-ink-faint">
          {fill(l.facets, {
            muscles: facets.muscles.length,
            equipment: facets.equipment.length,
          })}
        </p>
      </div>

      {/* One tall card that scrolls inside itself: the search, the filters and
          the count stay put while 873 exercises move underneath them. */}
      <Card plain className="mt-5 flex h-[calc(100vh-11rem)] min-h-[32rem] flex-col sm:mt-6 sm:p-5">
        <ExercisePicker muscles={facets.muscles} equipment={facets.equipment} />
      </Card>

      <p className="mt-3 text-[12.5px] text-ink-faint">{l.source}</p>
    </div>
  );
}
