// Gym reads (20261023100000, 20261117100000). Every one is an RPC: users_select hides
// everyone who is not the reader's coach or client, so the names on these
// lists come back from security-definer functions that return a name, a
// handle, an avatar and nothing else.
import "server-only";
import { cache } from "react";
import type { GymPeriod } from "@healthapp/shared";
import { supabaseServer } from "./supabase/server";

export type Gym = {
  id: string;
  name: string;
  city: string;
  address: string | null;
  maps_url: string | null;
  lat: number | null;
  lng: number | null;
};
export type GymHit = Gym & { status: "active" | "pending"; members: number; coaches: number };
export type GymRef = { id: string; name: string; city: string };
export type MyGyms = { home: Gym | null; board: boolean; pending: GymRef[] };

/** A published Coach Discovery profile located at a gym (gym_coaches_at, 20261024100000). */
export type GymCoach = {
  coach_profile_id: string;
  slug: string;
  display_name: string;
  avatar_url: string | null;
  headline: string | null;
  accepting_clients: boolean;
  request_pending: boolean;
};
export type MyCoachRequest = {
  id: string;
  coach_name: string;
  coach_slug: string | null;
  coach_avatar: string | null;
  gym_name: string | null;
  created_at: string;
};
export type InboxRequest = {
  id: string;
  client_id: string;
  client_name: string;
  client_username: string | null;
  client_avatar: string | null;
  client_city: string | null;
  gym_name: string | null;
  service_name: string | null;
  message: string | null;
  created_at: string;
};

const EMPTY: MyGyms = { home: null, board: false, pending: [] };

export const getMyGyms = cache(async (): Promise<MyGyms> => {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("my_gyms");
  if (error || !data) return EMPTY;
  const d = data as Partial<MyGyms>;
  return { home: d.home ?? null, board: Boolean(d.board), pending: d.pending ?? [] };
});

export async function searchGymsRpc(query: string, limit = 20): Promise<GymHit[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("search_gyms", { p_query: query.trim().slice(0, 80) || null, p_limit: limit });
  if (error) return [];
  return (data ?? []) as GymHit[];
}

export async function getGymCoaches(gymId: string): Promise<GymCoach[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("gym_coaches_at", { p_gym: gymId });
  if (error) return [];
  return (data ?? []) as GymCoach[];
}

export async function getMyCoachRequests(): Promise<MyCoachRequest[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("my_coach_requests");
  if (error) return [];
  return (data ?? []) as MyCoachRequest[];
}

export async function getCoachRequestInbox(): Promise<InboxRequest[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("coach_request_inbox");
  if (error) return [];
  return (data ?? []) as InboxRequest[];
}

// ---------- the map, tops and stats (20261117100000) ----------
// Every gym number sits behind a three-people floor in SQL: below it the
// figure is null, never zero, so a screen can say "not enough people yet".

export type GymPin = {
  id: string;
  name: string;
  city: string;
  address: string | null;
  lat: number;
  lng: number;
  members: number;
  coaches: number;
  athletes_30d: number | null;
  google_rating: number | null;
};

export type GymTopMetric = "workouts" | "athletes" | "volume" | "members";
export type GymTopPeriod = "week" | "month" | "all";
export const GYM_TOP_METRICS: readonly GymTopMetric[] = ["workouts", "athletes", "volume", "members"];
export const GYM_TOP_PERIODS: readonly GymTopPeriod[] = ["week", "month", "all"];

export type GymTopRow = {
  rank: number;
  gym_id: string;
  name: string;
  city: string;
  score: number;
  athletes: number;
  workouts: number;
  members: number;
};

export type GymStats = {
  gym: Gym & {
    google_place_id: string | null;
    google_rating: number | null;
    google_ratings_total: number | null;
    opening_hours: string[] | null;
    opening_periods: GymPeriod[] | null;
    google_business_status: string | null;
    phone: string | null;
    website: string | null;
    primary_type: string | null;
    summary: string | null;
    parking: Record<string, boolean> | null;
    accessibility: Record<string, boolean> | null;
    payment: Record<string, boolean> | null;
    has_photo: boolean;
    photo_attribution: string | null;
    google_refreshed_at: string | null;
  };
  members: number;
  board: number;
  coaches: number;
  week: { workouts: number; athletes: number } | null;
  month: { workouts: number; athletes: number; volume_kg: number } | null;
  busy_hours: number[] | null;
  busy_days: number[] | null;
  rank_month: number | null;
  is_home: boolean;
  my_month: number;
};

export async function getGymsMap(): Promise<GymPin[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("gyms_map");
  if (error) return [];
  return ((data ?? []) as GymPin[]).map((p) => ({ ...p, google_rating: p.google_rating == null ? null : Number(p.google_rating) }));
}

/** Gym-vs-gym tops — admin only since 20261117110000 (admin_gym_tops re-checks). */
export async function getAdminGymTops(metric: GymTopMetric, period: GymTopPeriod, city: string | null): Promise<GymTopRow[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("admin_gym_tops", {
    p_metric: metric, p_period: period, p_city: city?.trim().slice(0, 80) || null, p_limit: 50,
  });
  if (error) return [];
  return ((data ?? []) as GymTopRow[]).map((r) => ({ ...r, score: Number(r.score) }));
}

export async function getGymStats(gymId: string): Promise<GymStats | null> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("gym_stats", { p_gym: gymId });
  if (error || !data) return null;
  return data as GymStats;
}

export async function getRecentGyms(): Promise<GymRef[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("my_recent_gyms", { p_limit: 5 });
  if (error) return [];
  return (data ?? []) as GymRef[];
}

/** The gym a session of the caller's was logged at, if any (owner read, RLS). */
export async function getSessionGym(sessionId: string): Promise<GymRef | null> {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("logged_sessions")
    .select("gym_id, gyms(id, name, city)")
    .eq("id", sessionId)
    .maybeSingle<{ gym_id: string | null; gyms: GymRef | GymRef[] | null }>();
  const g = Array.isArray(data?.gyms) ? data?.gyms[0] : data?.gyms;
  return g ?? null;
}

// ---------- records at a gym (20261117110000) ----------
// The RPCs return each person's best SET; the value (heaviest weight or the
// estimated 1RM) is computed with relevantOneRm() from packages/shared, so the
// formula is the one the Progress and exercise pages use.

export type GymRecordKind = "e1rm" | "weight";
export type GymRecordPeriod = "all" | "year" | "month";
export const GYM_RECORD_KINDS: readonly GymRecordKind[] = ["e1rm", "weight"];
export const GYM_RECORD_PERIODS: readonly GymRecordPeriod[] = ["all", "year", "month"];

export type GymRecordLift = { exercise_id: string; name_en: string; name_ro: string; lifters: number };
export type GymRecordRow = {
  rank: number;
  user_id: string;
  display_name: string;
  username: string | null;
  avatar_url: string | null;
  weight_kg: number;
  reps: number;
  achieved_at: string;
  is_me: boolean;
};

export async function getGymRecordLifts(gymId: string): Promise<GymRecordLift[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("gym_record_lifts", { p_gym: gymId });
  if (error) return [];
  return (data ?? []) as GymRecordLift[];
}

export async function getGymRecords(
  gymId: string, exerciseId: string, kind: GymRecordKind, period: GymRecordPeriod,
): Promise<GymRecordRow[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("gym_records", {
    p_gym: gymId, p_exercise: exerciseId, p_kind: kind, p_period: period, p_limit: 10,
  });
  if (error) return [];
  return ((data ?? []) as GymRecordRow[]).map((r) => ({ ...r, weight_kg: Number(r.weight_kg) }));
}
