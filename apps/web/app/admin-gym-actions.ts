"use server";
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { adminActor } from "@/lib/admin/guard";
import { uuidOf } from "@/lib/admin/params";
import { isMapsHost, parseMapsUrl, type MapsLinkFacts } from "@/lib/gym-map";
import { findPlace, placeDetails, placePhotoUri, searchGymsInCity, type PlaceFacts } from "@/lib/google-places";
import { cloudinaryConfigured, destroyGymPhoto, uploadGymPhoto } from "@/lib/cloudinary";
import type { ActionResult } from "./actions";

/**
 * /admin/gyms writes. Same contract as admin-actions.ts: one RPC each, which
 * re-checks is_admin() in SQL and writes its own audit row.
 */
const PATHS = ["/admin/gyms", "/admin/activity", "/account", "/settings", "/coach"];

async function call(name: string, args: Record<string, unknown>): Promise<ActionResult> {
  if (!(await adminActor())) return { ok: false, message: "Admins only" };
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc(name, args);
  if (error) return { ok: false, message: error.message };
  for (const p of PATHS) revalidatePath(p);
  return { ok: true };
}

export type GymInput = {
  name: string;
  city: string;
  address: string;
  lat: string;
  lng: string;
  mapsUrl: string;
};

function num(v: string): number | null {
  const s = String(v ?? "").trim().replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/** What the form got from Google for this gym: Google's place object, parsed in SQL. */
export type GymGoogle = Record<string, unknown>;

async function storeGoogle(gymId: string, place: GymGoogle | null): Promise<ActionResult> {
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("admin_set_gym_google", { p_id: gymId, p_place: place });
  return error ? { ok: false, message: error.message } : { ok: true };
}

export async function saveGym(id: string | null, input: GymInput, google: GymGoogle | null = null): Promise<ActionResult> {
  const gym = id === null ? null : uuidOf(id);
  if (id !== null && !gym) return { ok: false, message: "Invalid id" };
  const lat = num(input?.lat);
  const lng = num(input?.lng);
  if (Number.isNaN(lat) || Number.isNaN(lng)) return { ok: false, message: "GYM_COORDS" };
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  if (!(await adminActor())) return { ok: false, message: "Admins only" };
  const supabase = await supabaseServer();
  const { data: savedId, error } = await supabase.rpc("admin_save_gym", {
    p_id: gym,
    p_name: str(input?.name, 120),
    p_city: str(input?.city, 80),
    p_address: str(input?.address, 200) || null,
    p_lat: lat,
    p_lng: lng,
    p_maps_url: str(input?.mapsUrl, 500) || null,
  });
  if (error) return { ok: false, message: error.message };
  // Google's rating and hours ride along when the link was matched to a place.
  if (google && typeof savedId === "string") {
    const stored = await storeGoogle(savedId, google);
    if (!stored.ok) return stored;
  }
  for (const p of PATHS) revalidatePath(p);
  return { ok: true };
}

/** The admin's "Refresh from Google": rating, hours and status, by the stored place id. */
export async function refreshGymFromGoogle(id: string): Promise<ActionResult> {
  const gym = uuidOf(id);
  if (!gym) return { ok: false, message: "Invalid id" };
  if (!(await adminActor())) return { ok: false, message: "Admins only" };
  const supabase = await supabaseServer();
  const { data } = await supabase.from("gyms").select("google_place_id").eq("id", gym).maybeSingle<{ google_place_id: string | null }>();
  if (!data?.google_place_id) return { ok: false, message: "GYM_PLACE" };
  const fresh = await placeDetails(data.google_place_id);
  if (!fresh) return { ok: false, message: "GOOGLE_UNAVAILABLE" };
  const stored = await storeGoogle(gym, fresh.raw);
  if (!stored.ok) return stored;
  for (const p of [...PATHS, "/gyms"]) revalidatePath(p);
  revalidatePath(`/gyms/${gym}`);
  return { ok: true };
}

export async function approveGym(id: string): Promise<ActionResult> {
  const gym = uuidOf(id);
  if (!gym) return { ok: false, message: "Invalid id" };
  return call("admin_approve_gym", { p_id: gym });
}

export async function deleteGym(id: string, _reason: string): Promise<ActionResult> {
  const gym = uuidOf(id);
  if (!gym) return { ok: false, message: "Invalid id" };
  const r = await call("admin_delete_gym", { p_id: gym });
  // Its copied photo goes with it (20261121120000). Best effort.
  if (r.ok && cloudinaryConfigured()) await destroyGymPhoto(gym);
  return r;
}

/**
 * Name and pin from a pasted Google Maps link, to prefill the form — the
 * admin checks them before saving. A short link (maps.app.goo.gl) is
 * followed by hand, at most five hops, and every hop must stay on a Google
 * Maps host (lib/gym-map), so this can never be pointed at anything else.
 */
export async function readMapsLink(raw: string): Promise<{ ok: boolean; facts?: MapsLinkFacts; place?: PlaceFacts | null }> {
  if (!(await adminActor())) return { ok: false };
  let url: URL;
  try {
    url = new URL(String(raw ?? "").trim());
  } catch {
    return { ok: false };
  }
  if (!isMapsHost(url)) return { ok: false };

  for (let hop = 0; hop < 5; hop++) {
    const facts = parseMapsUrl(url.href);
    if (facts.lat !== null || facts.name !== null) {
      // With a key, the place behind the link: address, rating, hours (lib/google-places).
      const place = facts.name ? await findPlace(facts.name, facts.lat, facts.lng) : null;
      return { ok: true, facts, place };
    }
    let res: Response;
    try {
      res = await fetch(url.href, {
        redirect: "manual",
        signal: AbortSignal.timeout(5000),
        headers: { "user-agent": "Mozilla/5.0 (compatible; Voinic admin link reader)" },
      });
    } catch {
      return { ok: false };
    }
    const location = res.headers.get("location");
    if (res.status < 300 || res.status >= 400 || !location) return { ok: false };
    let next: URL;
    try {
      next = new URL(location, url);
    } catch {
      return { ok: false };
    }
    if (!isMapsHost(next)) return { ok: false };
    url = next;
  }
  return { ok: false };
}

// ---------- bulk import from Google (20261121100000) ----------

export type GoogleGymHit = {
  raw: Record<string, unknown>;
  placeId: string;
  name: string;
  address: string | null;
  rating: number | null;
  ratingsTotal: number | null;
  known: boolean;
};

/** A city's gyms on Google, marked when they are already on our list. */
export async function searchGoogleGyms(city: string): Promise<{
  ok: boolean; message?: string; hits?: GoogleGymHit[]; calls?: number; capped?: boolean;
}> {
  if (!(await adminActor())) return { ok: false, message: "Admins only" };
  const search = await searchGymsInCity(String(city ?? ""));
  if (search === null) return { ok: false, message: "GOOGLE_UNAVAILABLE" };
  const places = search.places;
  const supabase = await supabaseServer();
  const { data } = await supabase.rpc("admin_known_place_ids", { p_ids: places.map((p) => p.placeId) });
  const known = new Set((data ?? []) as string[]);
  return {
    ok: true,
    calls: search.calls,
    capped: search.capped,
    hits: places.map((p) => ({
      raw: p.raw, placeId: p.placeId, name: p.name, address: p.address,
      rating: p.rating, ratingsTotal: p.ratingsTotal, known: known.has(p.placeId),
    })),
  };
}

/** Import the ticked places as active gyms of that city; known ones are skipped in SQL. */
export async function importGoogleGyms(
  city: string, places: Record<string, unknown>[],
): Promise<{ ok: boolean; message?: string; imported?: number; skipped?: number }> {
  if (!(await adminActor())) return { ok: false, message: "Admins only" };
  if (!Array.isArray(places) || places.length === 0 || places.length > 1000) return { ok: false, message: "GYM_IMPORT" };
  const supabase = await supabaseServer();
  let imported = 0;
  let skipped = 0;
  // admin_import_gyms takes up to 200 a call.
  for (let i = 0; i < places.length; i += 150) {
    const { data, error } = await supabase.rpc("admin_import_gyms", {
      p_places: places.slice(i, i + 150), p_city: String(city ?? "").trim().slice(0, 80),
    });
    if (error) return { ok: false, message: error.message, imported, skipped };
    const r = (data ?? {}) as { imported?: number; skipped?: number };
    imported += r.imported ?? 0;
    skipped += r.skipped ?? 0;
  }
  for (const p of [...PATHS, "/gyms"]) revalidatePath(p);
  return { ok: true, imported, skipped };
}

// ---------- gym photos into Cloudinary (20261121120000) ----------

/**
 * Copy the next few Google photos into Cloudinary: ask Google for each
 * photo's short-lived URL, let Cloudinary fetch it, record the result. One
 * call does up to 10, five at a time; the admin screen calls again until
 * `remaining` is 0. A photo Google refuses is recorded as none so the queue
 * moves on.
 */
export async function cacheGymPhotos(): Promise<{ ok: boolean; message?: string; done?: number; failed?: number; remaining?: number }> {
  if (!(await adminActor())) return { ok: false, message: "Admins only" };
  if (!cloudinaryConfigured()) return { ok: false, message: "CLOUDINARY_UNAVAILABLE" };
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("admin_gym_photo_queue", { p_limit: 10 });
  if (error) return { ok: false, message: error.message };
  const queue = (data ?? { remaining: 0, gyms: [] }) as { remaining: number; gyms: { id: string; photo_name: string }[] };
  let done = 0;
  let failed = 0;
  for (let i = 0; i < queue.gyms.length; i += 5) {
    await Promise.all(queue.gyms.slice(i, i + 5).map(async (g) => {
      let url: string | null = null;
      try {
        const source = await placePhotoUri(g.photo_name, 1200);
        if (source) url = await uploadGymPhoto(g.id, source);
      } catch (e) {
        console.error("cacheGymPhotos:", g.id, (e as Error).message);
      }
      const { error: setError } = await supabase.rpc("admin_set_gym_photo", { p_id: g.id, p_url: url, p_source: g.photo_name });
      if (url && !setError) done++; else failed++;
    }));
  }
  revalidatePath("/gyms", "layout");
  return { ok: true, done, failed, remaining: Math.max(0, queue.remaining - queue.gyms.length) };
}
