// The coach's marketplace at a glance (coach_marketplace_overview(),
// 20261108100000): one RPC, only the caller's own rows, no analytics that do
// not exist. Measured performance (views, clicks, sources) is its own read,
// getCoachMarketplaceAnalytics (20261110120000), shown only once there is data.
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
  clients: { active: number; invited: number; paused?: number };
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

/** coach_marketplace_analytics() (20261110120000): the caller's own performance over a window. */
export type CoachMarketplaceAnalytics = {
  window_days: number;
  /** When the event log began; null = nothing measured yet, so views and clicks are not shown. */
  tracking_since: string | null;
  profile_views: number; contact_clicks: number; book_clicks: number; signups: number;
  saves: number; saves_total: number;
  requests: number; requests_accepted: number;
  bookings: number; bookings_completed: number;
  review_count: number; review_avg: number | string | null;
  sources: { source: string; n: number }[];
  /** 20261111120000; absent before it. */
  service_views?: number; shares?: number; login_walls?: number;
};

/** A database without the function (PGRST202) answers null — the card is simply not drawn. */
export async function getCoachMarketplaceAnalytics(days = 30): Promise<CoachMarketplaceAnalytics | null> {
  const live = await liveUser();
  if (!live) return null;
  const { data, error } = await live.supabase.rpc("coach_marketplace_analytics", { p_days: days });
  if (error) {
    if (error.code !== "PGRST202") console.error("coach_marketplace_analytics:", error.message);
    return null;
  }
  return (data ?? null) as CoachMarketplaceAnalytics | null;
}
