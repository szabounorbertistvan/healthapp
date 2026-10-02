// "Open in maps" for a gym: the link it was saved with, else a maps search
// for its coordinates or its name and address. A link out only — nothing
// here calls a maps API.
export type MappableGym = {
  name: string;
  city: string;
  address?: string | null;
  maps_url?: string | null;
  lat?: number | null;
  lng?: number | null;
};

export function gymMapHref(g: MappableGym): string {
  if (g.maps_url) return g.maps_url;
  const query = g.lat != null && g.lng != null ? `${g.lat},${g.lng}` : [g.name, g.address, g.city].filter(Boolean).join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

// ---------- reading a Google Maps link (admin form only) ----------

/** Hosts a pasted maps link may start on or redirect through. Nothing else is fetched. */
const MAPS_HOSTS = new Set([
  "maps.app.goo.gl", "goo.gl", "maps.google.com", "google.com", "www.google.com",
  "google.ro", "www.google.ro", "maps.google.ro", "consent.google.com",
]);

export function isMapsHost(url: URL): boolean {
  return url.protocol === "https:" && MAPS_HOSTS.has(url.hostname.toLowerCase());
}

export type MapsLinkFacts = { name: string | null; lat: number | null; lng: number | null };

const coord = (lat: number, lng: number) =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

/**
 * The place name and pin of a long Google Maps URL, as far as the URL itself
 * says: `/maps/place/<Name>/…`, the place's own `!3d<lat>!4d<lng>` (the pin)
 * before the viewport's `@lat,lng` (the map centre), or `?q=lat,lng`. A
 * consent-page URL is unwrapped through its `continue` parameter.
 */
export function parseMapsUrl(raw: string): MapsLinkFacts {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { name: null, lat: null, lng: null };
  }
  if (url.hostname === "consent.google.com") {
    const next = url.searchParams.get("continue");
    return next ? parseMapsUrl(next) : { name: null, lat: null, lng: null };
  }
  const path = decodeURIComponent(url.pathname);
  const place = /\/maps\/place\/([^/]+)/.exec(path);
  const name = place ? place[1].replace(/\+/g, " ").trim() || null : null;

  const full = decodeURIComponent(url.href);
  const pin = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(full);
  const view = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(full);
  const q = /^(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)$/.exec(url.searchParams.get("q") ?? url.searchParams.get("query") ?? "");
  for (const m of [pin, view, q]) {
    if (m && coord(Number(m[1]), Number(m[2]))) {
      return { name, lat: Number(Number(m[1]).toFixed(6)), lng: Number(Number(m[2]).toFixed(6)) };
    }
  }
  return { name, lat: null, lng: null };
}
