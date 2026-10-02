// Gym reads (20261023100000). Every one is an RPC: users_select hides
// everyone who is not the reader's coach or client, so the names on these
// lists come back from security-definer functions that return a name, a
// handle, an avatar and nothing else.
import "server-only";
import { cache } from "react";
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
