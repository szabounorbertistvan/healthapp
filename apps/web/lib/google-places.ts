// Google Places (New) for the admin's gym form — server only, the way
// DishFinder does it: the map never talks to Google, only an admin adding or
// refreshing a gym does. Needs GOOGLE_PLACES_API_KEY (no NEXT_PUBLIC_ prefix:
// the key must never reach a browser); without it every call answers null
// and the form simply keeps what the pasted link said.
//
// New projects can only enable "Places API (New)" — the legacy endpoints
// DishFinder calls (Find Place, Place Details by ftid) are closed to them —
// so a pasted link is matched by Text Search around its pin instead of by its
// feature id. Rating, hours, phone and website are Enterprise-tier fields,
// parking / accessibility / payment / summary Enterprise + Atmosphere: an
// admin action and a monthly refresh, a few calls a month, inside the free
// monthly allowance. The raw place object goes to admin_set_gym_google(),
// which parses it in SQL (gym_apply_google) — the same parser the monthly
// refresh uses, so the form and the refresh can never disagree.
import "server-only";

export type PlaceFacts = {
  /** Google's own object, as stored by admin_set_gym_google(). */
  raw: Record<string, unknown>;
  placeId: string;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  rating: number | null;
  ratingsTotal: number | null;
  hours: string[] | null;
  businessStatus: string | null;
  mapsUrl: string | null;
};

// Mirrors gym_google_field_mask() in 20261117100000 — change both together.
const FIELDS = [
  "id", "displayName", "formattedAddress", "location", "rating", "userRatingCount",
  "regularOpeningHours.weekdayDescriptions", "regularOpeningHours.periods", "businessStatus", "googleMapsUri",
  "nationalPhoneNumber", "internationalPhoneNumber", "websiteUri", "types", "primaryType", "editorialSummary",
  "photos", "parkingOptions", "accessibilityOptions", "paymentOptions",
];

type ApiPlace = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  rating?: number;
  userRatingCount?: number;
  regularOpeningHours?: { weekdayDescriptions?: string[] };
  businessStatus?: string;
  googleMapsUri?: string;
};

export function placesConfigured(): boolean {
  return Boolean(process.env.GOOGLE_PLACES_API_KEY);
}

function factsOf(p: ApiPlace): PlaceFacts | null {
  if (!p.id || !/^[A-Za-z0-9_-]{1,300}$/.test(p.id)) return null;
  return {
    raw: p as Record<string, unknown>,
    placeId: p.id,
    name: p.displayName?.text?.slice(0, 120) ?? "",
    address: p.formattedAddress?.slice(0, 200) ?? null,
    lat: p.location?.latitude ?? null,
    lng: p.location?.longitude ?? null,
    rating: typeof p.rating === "number" ? p.rating : null,
    ratingsTotal: typeof p.userRatingCount === "number" ? p.userRatingCount : null,
    hours: p.regularOpeningHours?.weekdayDescriptions?.slice(0, 7).map((h) => h.slice(0, 120)) ?? null,
    businessStatus: p.businessStatus?.slice(0, 40) ?? null,
    mapsUrl: p.googleMapsUri && p.googleMapsUri.startsWith("https://") ? p.googleMapsUri.slice(0, 500) : null,
  };
}

/** Haversine distance in metres. */
function metres(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const r = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

/**
 * The place a pasted link points at: Text Search for its name biased to a
 * 2 km circle around its pin, then the closest result — anything farther
 * than 2 km is not this gym. Null without a key, a name or a match.
 */
export async function findPlace(name: string, lat: number | null, lng: number | null): Promise<PlaceFacts | null> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key || !name.trim()) return null;
  const body: Record<string, unknown> = { textQuery: name.trim().slice(0, 200), languageCode: "ro", maxResultCount: 5 };
  if (lat != null && lng != null) {
    body.locationBias = { circle: { center: { latitude: lat, longitude: lng }, radius: 2000 } };
  }
  try {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": FIELDS.map((f) => `places.${f}`).join(","),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!res.ok) {
      console.error("places:searchText failed:", res.status);
      return null;
    }
    const json = (await res.json()) as { places?: ApiPlace[] };
    const found = (json.places ?? []).map(factsOf).filter((p): p is PlaceFacts => p !== null);
    if (found.length === 0) return null;
    if (lat == null || lng == null) return found[0];
    const ranked = found
      .filter((p) => p.lat != null && p.lng != null)
      .map((p) => ({ p, d: metres(lat, lng, p.lat as number, p.lng as number) }))
      .sort((a, b) => a.d - b.d);
    return ranked[0] && ranked[0].d <= 2000 ? ranked[0].p : null;
  } catch (e) {
    console.error("places:searchText error:", (e as Error).message);
    return null;
  }
}

/** Fresh data for a known place id (the admin's "Refresh from Google"). */
export async function placeDetails(placeId: string): Promise<PlaceFacts | null> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key || !/^[A-Za-z0-9_-]{1,300}$/.test(placeId)) return null;
  try {
    const res = await fetch(`https://places.googleapis.com/v1/places/${placeId}?languageCode=ro`, {
      headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": FIELDS.join(",") },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!res.ok) {
      console.error("places details failed:", res.status);
      return null;
    }
    return factsOf((await res.json()) as ApiPlace);
  } catch (e) {
    console.error("places details error:", (e as Error).message);
    return null;
  }
}

/**
 * A short-lived image URL for a stored photo resource name
 * ("places/…/photos/…"). Google answers with a googleusercontent URL that
 * carries no key, so the browser is redirected there and never sees ours.
 */
export async function placePhotoUri(photoName: string, maxWidth = 900): Promise<string | null> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key || !/^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/.test(photoName)) return null;
  try {
    const res = await fetch(
      `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=${maxWidth}&skipHttpRedirect=true`,
      { headers: { "X-Goog-Api-Key": key }, signal: AbortSignal.timeout(8000), cache: "no-store" },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { photoUri?: string };
    return json.photoUri && json.photoUri.startsWith("https://") ? json.photoUri : null;
  } catch {
    return null;
  }
}

// ---------- a whole city, for the admin's bulk import ----------
// Text Search stops at 60 results (3 pages of 20), so one query per city
// silently drops the rest — Cluj-Napoca alone has more than 60 gyms. The city
// is searched as a grid instead: its viewport (from Google's own "locality"
// result) is one rectangle; a rectangle whose search comes back full is split
// in four and searched again, down to MAX_DEPTH. Two passes, type "gym" and
// type "fitness_center", because Google tags some clubs with only one of them.
// Every page returns the full field list, so a call yields up to 20 complete
// gyms (the cheapest way to fill the list) — and MAX_CALLS caps the bill.

type Rect = { low: { latitude: number; longitude: number }; high: { latitude: number; longitude: number } };
const GYM_TYPES = ["gym", "fitness_center"] as const;
const MAX_DEPTH = 4;
const MAX_CALLS = 160;

async function cityViewport(key: string, city: string): Promise<Rect | null> {
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: { "content-type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": "places.viewport,places.types" },
    body: JSON.stringify({ textQuery: city, includedType: "locality", languageCode: "ro", regionCode: "RO", pageSize: 1 }),
    signal: AbortSignal.timeout(10000),
    cache: "no-store",
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { places?: { viewport?: Rect }[] };
  const v = json.places?.[0]?.viewport;
  return v?.low && v?.high ? v : null;
}

function quarters(r: Rect): Rect[] {
  const midLat = (r.low.latitude + r.high.latitude) / 2;
  const midLng = (r.low.longitude + r.high.longitude) / 2;
  return [
    { low: { latitude: r.low.latitude, longitude: r.low.longitude }, high: { latitude: midLat, longitude: midLng } },
    { low: { latitude: r.low.latitude, longitude: midLng }, high: { latitude: midLat, longitude: r.high.longitude } },
    { low: { latitude: midLat, longitude: r.low.longitude }, high: { latitude: r.high.latitude, longitude: midLng } },
    { low: { latitude: midLat, longitude: midLng }, high: { latitude: r.high.latitude, longitude: r.high.longitude } },
  ];
}

export type CitySearch = { places: PlaceFacts[]; calls: number; capped: boolean };

/**
 * Every gym Google lists inside a city's viewport. Null without a key or
 * when Google does not know the city; `capped` when MAX_CALLS stopped the
 * grid before it was complete (search again: known gyms are skipped).
 */
export async function searchGymsInCity(city: string): Promise<CitySearch | null> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return null;
  const name = city.trim().slice(0, 80);
  if (!name) return { places: [], calls: 0, capped: false };
  const found = new Map<string, PlaceFacts>();
  let calls = 0;
  let capped = false;
  try {
    const viewport = await cityViewport(key, name);
    calls++;
    if (!viewport) return null;

    // One rectangle, one type: up to three pages. Full = Google had more.
    async function searchRect(rect: Rect, type: string): Promise<boolean> {
      let pageToken: string | undefined;
      let count = 0;
      for (let page = 0; page < 3; page++) {
        if (calls >= MAX_CALLS) { capped = true; return false; }
        calls++;
        const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "X-Goog-Api-Key": key as string,
            "X-Goog-FieldMask": [...FIELDS.map((f) => `places.${f}`), "places.addressComponents", "nextPageToken"].join(","),
          },
          body: JSON.stringify({
            textQuery: "sală de fitness",
            includedType: type,
            strictTypeFiltering: true,
            locationRestriction: { rectangle: rect },
            languageCode: "ro",
            regionCode: "RO",
            pageSize: 20,
            ...(pageToken ? { pageToken } : {}),
          }),
          signal: AbortSignal.timeout(10000),
          cache: "no-store",
        });
        if (!res.ok) {
          console.error("places:searchText (grid) failed:", res.status);
          return false;
        }
        const json = (await res.json()) as { places?: ApiPlace[]; nextPageToken?: string };
        for (const p of json.places ?? []) {
          const f = factsOf(p);
          if (f) { f.raw = { ...p }; found.set(f.placeId, f); }
        }
        count += json.places?.length ?? 0;
        pageToken = json.nextPageToken;
        // Google's third page carries no token even when more exist: 60 means full.
        if (!pageToken) break;
      }
      return count >= 60;
    }

    for (const type of GYM_TYPES) {
      // Breadth-first over the quadtree, four rectangles at a time.
      let level: Rect[] = [viewport];
      for (let depth = 0; level.length > 0 && !capped; depth++) {
        const next: Rect[] = [];
        for (let i = 0; i < level.length && !capped; i += 4) {
          const batch = level.slice(i, i + 4);
          const full = await Promise.all(batch.map((r) => searchRect(r, type)));
          batch.forEach((r, j) => { if (full[j] && depth < MAX_DEPTH) next.push(...quarters(r)); });
        }
        level = next;
      }
    }
  } catch (e) {
    console.error("places:searchText (grid) error:", (e as Error).message);
  }
  return { places: [...found.values()], calls, capped };
}
