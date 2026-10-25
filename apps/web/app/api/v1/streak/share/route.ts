import type { WriteResultV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { shareStreak } from "@/app/social-actions";

// Post one streak milestone to the feed — the web's shareStreak(); the server re-reads the streak and dedupes.
export const dynamic = "force-dynamic";

export const POST = v1Route(async (request) => {
  const b = (await request.json().catch(() => null)) as { milestone?: unknown; streakStart?: unknown; visibility?: unknown } | null;
  if (!b || typeof b.milestone !== "number" || typeof b.streakStart !== "string") return apiJson<WriteResultV1>({ ok: false, message: "invalid share" }, 400);
  const r = await shareStreak(b.milestone, b.streakStart, typeof b.visibility === "string" ? b.visibility : undefined);
  return apiJson<WriteResultV1>({ ok: r.ok, message: r.message });
});
