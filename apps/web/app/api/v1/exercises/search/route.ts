import type { ExerciseSearchV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { searchExerciseLibrary } from "@/app/library-actions";
import { exerciseImage } from "@/lib/exercise-images";

// The exercise library search the builder's picker runs — searchExerciseLibrary()
// itself: ?q= every word in a name, ?muscle= a primary muscle, ?offset= the next page.
export const dynamic = "force-dynamic";

export const GET = v1Route(async (request) => {
  const params = new URL(request.url).searchParams;
  const offset = Math.max(0, Number(params.get("offset")) || 0);
  const { results, total } = await searchExerciseLibrary(
    { q: params.get("q") ?? "", muscle: params.get("muscle") ?? "", equipment: "" },
    offset,
  );
  return apiJson<ExerciseSearchV1>({
    total,
    results: results.flatMap((e) =>
      e.id
        ? [{ id: e.id, name: e.name_ro ?? e.name_en, equipment: e.equipment, primary_muscles: e.primary_muscles, image: e.images[0] ? exerciseImage(e.images[0]) : null, mine: Boolean(e.mine) }]
        : [],
    ),
  });
});
