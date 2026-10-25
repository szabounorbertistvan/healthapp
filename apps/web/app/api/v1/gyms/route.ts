import type { GymsV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { getProfile } from "@/lib/data";
import { getGymsMap, getMyGyms } from "@/lib/gym-data";
import { gymMapHref } from "@/lib/gym-map";

// The gyms list — what the web's /gyms shows under its map: the reader's own
// town (their gym's, else their profile's), best rated first, 60 at most.
export const dynamic = "force-dynamic";

const norm = (v: string | null | undefined) => (v ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

export const GET = v1Route(async () => {
  const [pins, my, profile] = await Promise.all([getGymsMap(), getMyGyms(), getProfile()]);
  const town = my.home?.city ?? profile?.city ?? null;
  const local = town ? pins.filter((p) => norm(p.city) === norm(town)) : [];
  const listed = (local.length > 0 ? local : pins)
    .slice()
    .sort((a, b) => (b.google_rating ?? 0) - (a.google_rating ?? 0) || a.name.localeCompare(b.name))
    .slice(0, 60);
  return apiJson<GymsV1>({
    home: my.home ? { id: my.home.id, name: my.home.name, city: my.home.city, address: my.home.address, map_url: gymMapHref(my.home) } : null,
    city: local[0]?.city ?? null,
    total: pins.length,
    items: listed.map((p) => ({ id: p.id, name: p.name, city: p.city, google_rating: p.google_rating, members: p.members, coaches: p.coaches })),
  });
});
