// The coach's marketplace at a glance (coach_marketplace_overview(),
// 20261108100000): one RPC, only the caller's own rows, no analytics that do
// not exist (there are no profile views to show, so none are shown).
import "server-only";
import { liveUser } from "@/lib/supabase/server";
import type { CoachProfileStatus, CoachVerificationStatus } from "./coach-profile";
import type { RevisionStatus } from "./coach-revision";

export type MarketplaceOverview = {
  profile: {
    id: string; slug: string; status: CoachProfileStatus; verification_status: CoachVerificationStatus;
    accepting_clients: boolean; review_count: number; review_avg: number | string | null; review_note: string | null;
    revision_status: RevisionStatus | null;
  } | null;
  requests: { pending: number; accepted: number };
  bookings: {
    pending: number; upcoming: number; needs_outcome: number;
    next: { start_at: string; end_at: string; timezone: string; service_name: string; status: string; client_name: string } | null;
  };
  clients: { active: number; invited: number };
  messages: { unread: number; conversations_unread: number };
  services: { active: number; bookable: number } | null;
  availability: { blocks: number };
  reviews: { latest: { id: string; rating: number; body: string | null; created_at: string; answered: boolean; reviewer_name: string }[] };
};

export async function getMarketplaceOverview(): Promise<MarketplaceOverview | null> {
  const live = await liveUser();
  if (!live) return null;
  const { data, error } = await live.supabase.rpc("coach_marketplace_overview");
  if (error) throw new Error(`marketplace overview: ${error.message}`);
  return (data ?? null) as MarketplaceOverview | null;
}
