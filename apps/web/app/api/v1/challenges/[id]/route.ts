import type { ChallengeDetailV1 } from "@healthapp/api/v1";
import { apiError, apiJson, v1Route } from "@/lib/api/v1";
import { challengeCard } from "@/lib/api/challenges";
import { getChallenge } from "@/lib/challenges-data";
import { getI18n } from "@/lib/i18n/server";

// One challenge's page for the app — /challenges/[id]'s own read: the card,
// what the type counts, the milestones the database stamped, and the board.
export const dynamic = "force-dynamic";

export const GET = v1Route(async (request) => {
  const id = decodeURIComponent(new URL(request.url).pathname.split("/").at(-1) ?? "");
  const [{ t }, c] = await Promise.all([getI18n(), getChallenge(id)]);
  if (!c) return apiError("not_found", 404);
  const ch = t.common.challenges;
  return apiJson<ChallengeDetailV1>({
    ...challengeCard(c, ch),
    type_hint: `${ch.typeHint[c.type]}${c.type === "strength_gain" ? ` ${ch.strengthNoBaseline}` : ""}`,
    milestones: c.milestones,
    mine: c.mine,
    leaderboard: c.leaderboard,
  });
});
