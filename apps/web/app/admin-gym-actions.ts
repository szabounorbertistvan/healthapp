"use server";
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { adminActor } from "@/lib/admin/guard";
import { uuidOf } from "@/lib/admin/params";
import { isMapsHost, parseMapsUrl, type MapsLinkFacts } from "@/lib/gym-map";
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

export async function saveGym(id: string | null, input: GymInput): Promise<ActionResult> {
  const gym = id === null ? null : uuidOf(id);
  if (id !== null && !gym) return { ok: false, message: "Invalid id" };
  const lat = num(input?.lat);
  const lng = num(input?.lng);
  if (Number.isNaN(lat) || Number.isNaN(lng)) return { ok: false, message: "GYM_COORDS" };
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  return call("admin_save_gym", {
    p_id: gym,
    p_name: str(input?.name, 120),
    p_city: str(input?.city, 80),
    p_address: str(input?.address, 200) || null,
    p_lat: lat,
    p_lng: lng,
    p_maps_url: str(input?.mapsUrl, 500) || null,
  });
}

export async function approveGym(id: string): Promise<ActionResult> {
  const gym = uuidOf(id);
  if (!gym) return { ok: false, message: "Invalid id" };
  return call("admin_approve_gym", { p_id: gym });
}

export async function deleteGym(id: string, _reason: string): Promise<ActionResult> {
  const gym = uuidOf(id);
  if (!gym) return { ok: false, message: "Invalid id" };
  return call("admin_delete_gym", { p_id: gym });
}

/**
 * Name and pin from a pasted Google Maps link, to prefill the form — the
 * admin checks them before saving. A short link (maps.app.goo.gl) is
 * followed by hand, at most five hops, and every hop must stay on a Google
 * Maps host (lib/gym-map), so this can never be pointed at anything else.
 */
export async function readMapsLink(raw: string): Promise<{ ok: boolean; facts?: MapsLinkFacts }> {
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
    if (facts.lat !== null || facts.name !== null) return { ok: true, facts };
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
