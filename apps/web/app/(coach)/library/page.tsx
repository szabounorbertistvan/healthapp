import { exerciseFacets } from "@/lib/exercise-library";
import { Card, PageTitle } from "@/components/ui";
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

  return (
    <div>
      <PageTitle title={t.coachApp.library.title}>
        <span className="text-sm text-ink-soft">
          {fill(t.coachApp.library.facets, {
            muscles: facets.muscles.length,
            equipment: facets.equipment.length,
          })}
        </span>
      </PageTitle>

      <Card className="flex h-[calc(100vh-12rem)] flex-col">
        <ExercisePicker muscles={facets.muscles} equipment={facets.equipment} />
      </Card>

      <p className="mt-3 text-xs text-ink-faint">
        {t.coachApp.library.source}
      </p>
    </div>
  );
}
