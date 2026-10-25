import type { GymV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { searchGyms } from "@/app/gym-actions";
import { gymMapHref } from "@/lib/gym-map";

// The gym search behind "My gym" — the web's searchGyms(): the caller's city
// when the query is empty, then whatever matches name, city or street.
export const dynamic = "force-dynamic";

export const GET = v1Route(async (request) => {
  const q = new URL(request.url).searchParams.get("q") ?? "";
  const hits = await searchGyms(q);
  return apiJson<(GymV1 & { members: number; coaches: number })[]>(
    hits.map((g) => ({ id: g.id, name: g.name, city: g.city, address: g.address, map_url: gymMapHref(g), members: g.members, coaches: g.coaches })),
  );
});
