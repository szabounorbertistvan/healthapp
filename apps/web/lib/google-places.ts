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
