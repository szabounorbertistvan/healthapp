import type { CoachChallengesV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { getCoachChallenges } from "@/lib/challenges-data";

// The challenges the coach's active clients joined — the web's
// /clients/challenges, read-only: each challenge with every client's progress.
export const dynamic = "force-dynamic";

export const GET = v1Route(async () => {
  const rows = await getCoachChallenges();
  return apiJson<CoachChallengesV1>(rows.map(({ challenge: c, clients }) => ({
    challenge: { id: c.id, title: c.title, type: c.type, target: c.target, status: c.status },
    clients,
  })));
});
