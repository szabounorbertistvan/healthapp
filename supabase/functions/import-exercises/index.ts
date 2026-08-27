// HealthApp · import-exercises edge function
// Pulls the exercise library from Free Exercise DB (public domain / Unlicense,
// https://github.com/yuhonas/free-exercise-db) and upserts it into `exercises`
// as system rows (owner_id null). Idempotent on (source, external_id) — safe to
// re-run for updates. Admin-only: requires the service role key as Bearer token.
//
// Run once after deploy:
//   curl -X POST "$SUPABASE_URL/functions/v1/import-exercises" \
//        -H "Authorization: Bearer $SERVICE_ROLE_KEY"
import { createClient } from "jsr:@supabase/supabase-js@2";

const SOURCE_URL =
  "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json";
const IMAGE_BASE =
  "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/";

type FedbExercise = {
  id: string;
  name: string;
  force: string | null;
  level: string | null;
  mechanic: string | null;
  equipment: string | null;
  category: string | null;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  instructions: string[];
  images: string[];
};

Deno.serve(async (req) => {
  const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  if (token !== Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) {
    return json({ error: "unauthorized" }, 401);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const res = await fetch(SOURCE_URL, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) return json({ error: "source_unavailable", status: res.status }, 502);
  const data: FedbExercise[] = await res.json();

  const rows = data.map((e) => ({
    owner_id: null,
    source: "free-exercise-db",
    external_id: e.id,
    name_en: e.name,
    category: e.category,
    level: e.level,
    force: e.force,
    mechanic: e.mechanic,
    equipment: e.equipment,
    primary_muscles: e.primaryMuscles ?? [],
    secondary_muscles: e.secondaryMuscles ?? [],
    instructions_en: (e.instructions ?? []).join("\n"),
    images: (e.images ?? []).map((p) => IMAGE_BASE + p),
  }));

  // upsert in chunks to stay under payload limits
  let imported = 0;
  const errors: string[] = [];
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const { error, count } = await supabase
      .from("exercises")
      .upsert(chunk, { onConflict: "source,external_id", count: "exact" });
    if (error) errors.push(`chunk ${i}: ${error.message}`);
    else imported += count ?? chunk.length;
  }

  return json({ total: rows.length, imported, errors });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
