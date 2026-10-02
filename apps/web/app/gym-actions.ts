"use server";
import { revalidatePath } from "next/cache";
import { liveUser } from "@/lib/supabase/server";
import { getPlan } from "@/lib/plan";
import { searchGymsRpc, type GymHit } from "@/lib/gym-data";
import { GYM_ERROR_CODES, type GymErrorCode } from "@/lib/i18n/messages/gyms";

/**
 * Gym writes (20261023100000, 20261024100000). Each is one RPC that validates in SQL; the
 * business codes it raises (GYM_NOT_FOUND, REQUEST_RATE, …) come back as
 * `error` so the card shows the sentence for it from t.gyms.errors.
 */
export type GymResult = { ok: boolean; error?: GymErrorCode };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idOf = (v: unknown): string | null => (typeof v === "string" && UUID.test(v) ? v.toLowerCase() : null);

/** The business code in a PostgREST error, if it is one of ours. */
function codeOf(message: string | undefined): GymErrorCode | undefined {
  if (!message) return undefined;
  return GYM_ERROR_CODES.find((c) => message.includes(c));
}

async function call(name: string, args: Record<string, unknown>, paths: string[]): Promise<GymResult> {
  const live = await liveUser();
  if (!live) return { ok: false };
  const { error } = await live.supabase.rpc(name, args);
  if (error) {
    const code = codeOf(error.message);
    if (!code) console.error(`${name} failed:`, error.message);
    return { ok: false, error: code };
  }
  for (const p of paths) revalidatePath(p);
  return { ok: true };
}

const ACCOUNT_PATHS = ["/account", "/settings", "/leaderboards", "/coach"];

export async function searchGyms(query: string): Promise<GymHit[]> {
  if (typeof query !== "string") return [];
  return searchGymsRpc(query);
}

export async function setHomeGym(gymId: string | null, board: boolean): Promise<GymResult> {
  const id = gymId === null ? null : idOf(gymId);
  if (gymId !== null && !id) return { ok: false, error: "GYM_NOT_FOUND" };
  return call("set_home_gym", { p_gym: id, p_board: Boolean(board) }, ACCOUNT_PATHS);
}

export async function suggestGym(input: { name: string; city: string; address?: string; mapsUrl?: string }): Promise<GymResult> {
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  return call("suggest_gym", {
    p_name: str(input?.name, 120),
    p_city: str(input?.city, 80),
    p_address: str(input?.address, 200) || null,
    p_maps_url: str(input?.mapsUrl, 500) || null,
  }, ["/account", "/settings", "/admin/gyms"]);
}

export async function requestCoach(coachProfileId: string, gymId: string | null, message: string): Promise<GymResult> {
  const profile = idOf(coachProfileId);
  if (!profile) return { ok: false, error: "COACH_NOT_FOUND" };
  return call("request_coaching", {
    p_coach_profile: profile,
    p_service: null,
    p_message: typeof message === "string" ? message.trim().slice(0, 2000) || null : null,
    p_gym: idOf(gymId),
  }, ["/coach"]);
}

/** The client takes back a pending request (Coach Discovery's cancel_coaching_request()). */
export async function withdrawCoachRequest(requestId: string): Promise<GymResult> {
  const id = idOf(requestId);
  if (!id) return { ok: false, error: "REQUEST_NOT_PENDING" };
  return call("cancel_coaching_request", { p_request: id }, ["/coach"]);
}

const INBOX_PATHS = ["/clients", "/dashboard", "/messages"];

/**
 * The coach answers a request. Accepting (accept_coaching_request(),
 * 20261024100000) is held to the same client limit the invite button is, and
 * keeps one active coach per client: if the client found one meanwhile the
 * request is closed and ALREADY_HAS_COACH comes back.
 */
export async function respondCoachRequest(requestId: string, accept: boolean): Promise<GymResult> {
  const id = idOf(requestId);
  if (!id) return { ok: false, error: "REQUEST_NOT_PENDING" };
  if (!accept) return call("decline_coaching_request", { p_request: id, p_reason: null }, INBOX_PATHS);

  const live = await liveUser();
  if (!live) return { ok: false };
  const [plan, { count }] = await Promise.all([
    getPlan(),
    live.supabase.from("trainer_clients").select("id", { count: "exact", head: true })
      .eq("coach_id", live.userId).eq("status", "active"),
  ]);
  if ((count ?? 0) >= plan.e.maxClients) return { ok: false, error: "CLIENT_LIMIT" };

  const { data, error } = await live.supabase.rpc("accept_coaching_request", { p_request: id });
  for (const path of INBOX_PATHS) revalidatePath(path);
  if (error) {
    const code = codeOf(error.message);
    if (!code) console.error("accept_coaching_request failed:", error.message);
    return { ok: false, error: code };
  }
  return data === "accepted" ? { ok: true } : { ok: false, error: "ALREADY_HAS_COACH" };
}
