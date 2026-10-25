import type { ImportPreviewV1 } from "@healthapp/api/v1";
import { DEFAULT_TIMEZONE, type WeightUnit } from "@healthapp/shared";
import { apiJson, v1Route } from "@/lib/api/v1";
import { getProfile } from "@/lib/data";
import { buildMatchIndex, matchExercise } from "@/lib/import/exercise-match";
import { getImportLibrary } from "@/lib/import/library-data";
import { exerciseNames, MAX_IMPORT_BYTES, parseWorkoutCsv } from "@/lib/import/workout-csv";

// A workout export read for the phone. On the web the browser runs these same
// pure functions on the picked file; the app sends the text here instead and
// gets back what the page shows: the sessions, the skips, and every exercise
// name with its automatic match and shortlist. Nothing is written.
export const dynamic = "force-dynamic";

export const POST = v1Route(async (request) => {
  const b = (await request.json().catch(() => null)) as { csv?: unknown; unit?: unknown } | null;
  if (!b || typeof b.csv !== "string") return apiJson<ImportPreviewV1>({ ok: false, error: "empty" }, 400);
  if (b.csv.length > MAX_IMPORT_BYTES) return apiJson<ImportPreviewV1>({ ok: false, error: "tooLarge" });
  const [profile, library] = await Promise.all([getProfile(), getImportLibrary()]);
  const unit: WeightUnit = b.unit === "lb" || b.unit === "kg" ? b.unit : profile?.weight_unit ?? "kg";
  const r = parseWorkoutCsv(b.csv, { weightUnit: unit, timeZone: profile?.timezone || DEFAULT_TIMEZONE });
  if (!r.ok) return apiJson<ImportPreviewV1>({ ok: false, error: r.error });
  const index = buildMatchIndex(library);
  const byId = new Map(library.map((e) => [e.id, e]));
  return apiJson<ImportPreviewV1>({
    ok: true,
    format: r.format,
    weight_unit: r.weightUnit,
    unit_from_file: r.unitFromFile,
    sessions: r.sessions,
    skipped: r.skipped,
    names: exerciseNames(r.sessions).map(({ name, sets }) => {
      const match = matchExercise(name, index);
      return {
        name,
        sets,
        match: match.exerciseId,
        suggestions: match.suggestions.flatMap((id) => {
          const e = byId.get(id);
          return e ? [{ id, name: e.name_ro ?? e.name_en }] : [];
        }),
      };
    }),
  });
});
