import type { CoachRelationshipPageV1 } from "@healthapp/api/v1";
import { apiError, apiJson, v1Route } from "@/lib/api/v1";
import { getCoachClientRelationships, getRelationshipHistory } from "@/lib/coaching-data";

// One coaching relationship from the coach's side — the web's
// /clients/relationship/[id]: where it stands and its history. Nothing of the
// client's training is read here (that stays behind is_active_coach_of()).
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET = v1Route(async (request) => {
  const id = decodeURIComponent(new URL(request.url).pathname.split("/").at(-1) ?? "");
  if (!UUID.test(id)) return apiError("not_found", 404);
  const [all, history] = await Promise.all([getCoachClientRelationships("all"), getRelationshipHistory(id)]);
  const relationship = all.find((x) => x.id === id);
  if (!relationship) return apiError("not_found", 404);
  return apiJson<CoachRelationshipPageV1>({ relationship, history });
});
