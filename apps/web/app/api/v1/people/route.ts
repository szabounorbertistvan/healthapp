import type { PeopleV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { getSuggestedPeople, searchPeople } from "@/lib/social-data";

// Discover people — the web's /people: search by name, handle or city when
// either has two letters (social_search_users), else the counted suggestions.
export const dynamic = "force-dynamic";

export const GET = v1Route(async (request) => {
  const p = new URL(request.url).searchParams;
  const q = p.get("q") ?? "";
  const city = p.get("city") ?? "";
  const searching = q.trim().length >= 2 || city.trim().length >= 2;
  const [results, suggested] = await Promise.all([
    searching ? searchPeople(q, city || null, Number(p.get("page") ?? "1")) : Promise.resolve(null),
    searching ? Promise.resolve([]) : getSuggestedPeople(),
  ]);
  return apiJson<PeopleV1>({ results, suggested });
});
