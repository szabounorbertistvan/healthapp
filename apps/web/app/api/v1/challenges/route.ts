import type { ChallengesV1, CreateChallengeV1, WriteResultV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { createChallenge } from "@/app/challenge-actions";
import { challengeCard } from "@/lib/api/challenges";
import { getMyChallenges } from "@/lib/challenges-data";
import { getMyPrs } from "@/lib/client-data";
import { getI18n } from "@/lib/i18n/server";

// The app's challenges: /challenges' own read (challenge_cards — progress
// computed in SQL), the lifts an exercise challenge can be about, and a new
// challenge through the web's createChallenge().
export const dynamic = "force-dynamic";

export const GET = v1Route(async () => {
  const [{ t }, cards, prs] = await Promise.all([getI18n(), getMyChallenges(), getMyPrs()]);
  const ch = t.common.challenges;
  return apiJson<ChallengesV1>({
    cards: cards.map((c) => challengeCard(c, ch)),
    exercises: prs
      .filter((p): p is typeof p & { exercise_id: string } => p.exercise_id !== null)
      .map((p) => ({ id: p.exercise_id, name: p.exercise }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  });
});

export const POST = v1Route(async (request) => {
  const b = (await request.json().catch(() => null)) as CreateChallengeV1 | null;
  if (!b || typeof b.name !== "string" || typeof b.type !== "string") {
    return apiJson<WriteResultV1 & { id?: string }>({ ok: false, message: "invalid challenge" }, 400);
  }
  const result = await createChallenge(b);
  return apiJson<WriteResultV1 & { id?: string }>({ ok: result.ok, message: result.message, id: result.id });
});
