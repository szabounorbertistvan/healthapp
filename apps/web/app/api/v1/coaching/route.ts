import type { MyCoachingV1 } from "@healthapp/api/v1";
import { isCurrent } from "@healthapp/shared";
import { apiJson, v1Route } from "@/lib/api/v1";
import { hasActiveCoach } from "@/lib/client-data";
import { getMyCoachingRelationships, getRelationshipHistory } from "@/lib/coaching-data";
import { getGymCoaches, getMyGyms } from "@/lib/gym-data";

// The client's coach — the web's /coach: the current relationship (active or
// paused) with its history, the past ones as history, and without a current
// coach the home gym's coaches. The conversation is /api/v1/threads/[id].
export const dynamic = "force-dynamic";

export const GET = v1Route(async () => {
  const relationships = await getMyCoachingRelationships();
  const current = relationships.find((r) => isCurrent(r.status)) ?? null;
  const past = relationships.filter((r) => r.status === "ended");
  if (current) {
    const history = await getRelationshipHistory(current.id);
    return apiJson<MyCoachingV1>({ current, history, past, legacy: false, gym: null, gym_coaches: [] });
  }
  // a database without the lifecycle yet lists nothing; an active coach is still found the old way
  const [legacy, gyms] = await Promise.all([relationships.length === 0 ? hasActiveCoach() : Promise.resolve(false), getMyGyms()]);
  const coaches = gyms.home ? await getGymCoaches(gyms.home.id) : [];
  return apiJson<MyCoachingV1>({
    current: null, history: [], past, legacy,
    gym: gyms.home ? { id: gyms.home.id, name: gyms.home.name } : null,
    gym_coaches: coaches.map((c) => ({ slug: c.slug, display_name: c.display_name, avatar_url: c.avatar_url, headline: c.headline, accepting_clients: c.accepting_clients })),
  });
});
