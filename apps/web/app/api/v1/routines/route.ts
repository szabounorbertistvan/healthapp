import type { RoutinesV1 } from "@healthapp/api/v1";
import { isFilterActive, normalizeRoutineFilter, type RoutineCard } from "@healthapp/shared";
import { apiJson, v1Route } from "@/lib/api/v1";
import { getDiscoverRoutines, getFeaturedRoutines, getMyRoutines, getSavedRoutines } from "@/lib/routine-data";

// The routine library — the web's /routines: ?tab=mine (default) | discover | saved,
// and for Discover ?q= and ?page= with the same reads and the same Featured rule.
export const dynamic = "force-dynamic";

export const GET = v1Route(async (request) => {
  const params = new URL(request.url).searchParams;
  const tab = params.get("tab");
  if (tab !== "discover") {
    const cards: RoutineCard[] = tab === "saved" ? await getSavedRoutines() : await getMyRoutines();
    return apiJson<RoutinesV1>({ cards, featured: [], has_more: false });
  }
  const filter = normalizeRoutineFilter({ q: params.get("q") ?? undefined });
  const page = Math.max(1, parseInt(params.get("page") ?? "1", 10) || 1);
  const showFeatured = page === 1 && !isFilterActive(filter);
  const [found, featured] = await Promise.all([
    getDiscoverRoutines(filter, page),
    showFeatured ? getFeaturedRoutines() : Promise.resolve([]),
  ]);
  return apiJson<RoutinesV1>({ cards: found.cards, featured, has_more: found.hasMore });
});
