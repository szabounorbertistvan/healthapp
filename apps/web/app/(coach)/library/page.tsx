import { exerciseFacets } from "@/lib/exercise-library";
import { Card, PageTitle } from "@/components/ui";
import { ExercisePicker } from "@/components/exercise-picker";

// W5 · Exercise library. The system library is the Free Exercise DB (873
// exercises, public domain), seeded into supabase/seed/exercises.json and
// upserted into `exercises` by the import-exercises function. Romanian names
// are still empty — the plan asks for the top ~200 translated before beta.
export default async function LibraryPage() {
  const facets = exerciseFacets();

  return (
    <div>
      <PageTitle title="Exercise library">
        <span className="text-sm text-ink-soft">
          {facets.muscles.length} muscle groups · {facets.equipment.length} equipment types
        </span>
      </PageTitle>

      <Card className="flex h-[calc(100vh-12rem)] flex-col">
        <ExercisePicker muscles={facets.muscles} equipment={facets.equipment} />
      </Card>

      <p className="mt-3 text-xs text-ink-faint">
        Source: Free Exercise DB (public domain). Attribution stays with the data.
      </p>
    </div>
  );
}
