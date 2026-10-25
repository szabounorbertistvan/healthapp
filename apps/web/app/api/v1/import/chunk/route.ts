import type { ImportChunkResultV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { importWorkoutChunk, type ImportChunkSession } from "@/app/import-actions";

// A few days of imported workouts — the web's importWorkoutChunk(), which holds every set to the logger's rules.
export const dynamic = "force-dynamic";

export const POST = v1Route(async (request) => {
  const b = (await request.json().catch(() => null)) as { sessions?: unknown } | null;
  const r = await importWorkoutChunk((Array.isArray(b?.sessions) ? b.sessions : []) as ImportChunkSession[]);
  return apiJson<ImportChunkResultV1>({ ok: r.ok, message: r.message, sessions: r.sessions, sets: r.sets, already: r.already, dayTaken: r.dayTaken, future: r.future });
});
