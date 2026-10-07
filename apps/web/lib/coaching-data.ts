// Coaching relationships, read for their lifecycle (20261109110000). One
// source for every screen that shows "who coaches whom, and how it stands":
// the client's Coach page, the coach's client lists, a relationship's page.
// Public names only; nothing of the client's training is read here.
import "server-only";
import { liveUser } from "@/lib/supabase/server";
import type { EndReason, PauseReason, RelationshipStatus } from "@healthapp/shared";

type Common = {
  id: string;
  status: RelationshipStatus;
  started_at: string;
  paused_at: string | null;
  paused_by_me: boolean | null;
  pause_reason: PauseReason | null;
  ended_at: string | null;
  ended_by_me: boolean | null;
  end_reason: EndReason | null;
  conversation_id: string | null;
  completed_bookings: number;
};

export type MyCoachingRelationship = Common & {
  coach_id: string; coach_name: string; coach_avatar: string | null; coach_slug: string | null;
  my_review: { rating: number; status: string } | null;
};

export type CoachClientRelationship = Common & {
  client_id: string; client_name: string; client_avatar: string | null; next_booking_at: string | null;
};

export type RelationshipEvent = {
  from_status: RelationshipStatus | null; to_status: RelationshipStatus; actor: "me" | "other" | "system";
  reason: string | null; created_at: string;
};

/** The client's relationships: the current one (active / paused) first, then the past ones. */
export async function getMyCoachingRelationships(): Promise<MyCoachingRelationship[]> {
  const live = await liveUser();
  if (!live) return [];
  const { data, error } = await live.supabase.rpc("my_coaching_relationships");
  // a database without the lifecycle yet (PGRST202) has no relationship list to show
  if (error?.code === "PGRST202") return [];
  if (error) throw new Error(`my coaching: ${error.message}`);
  return (data ?? []) as MyCoachingRelationship[];
}

/** The coach's clients by relationship: current, paused, past or all. */
export async function getCoachClientRelationships(scope: "all" | "current" | "paused" | "past" = "all"): Promise<CoachClientRelationship[]> {
  const live = await liveUser();
  if (!live) return [];
  const { data, error } = await live.supabase.rpc("coach_client_relationships", { p_scope: scope });
  if (error?.code === "PGRST202") return [];
  if (error) throw new Error(`coach clients: ${error.message}`);
  return (data ?? []) as CoachClientRelationship[];
}

/** One relationship's timeline, for its two participants (empty for anyone else). */
export async function getRelationshipHistory(relationshipId: string): Promise<RelationshipEvent[]> {
  const live = await liveUser();
  if (!live) return [];
  const { data, error } = await live.supabase.rpc("coaching_relationship_history", { p_relationship: relationshipId });
  if (error?.code === "PGRST202") return [];
  if (error) throw new Error(`coaching history: ${error.message}`);
  return (data ?? []) as RelationshipEvent[];
}
