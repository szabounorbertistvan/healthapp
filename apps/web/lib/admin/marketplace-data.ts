// Admin reads for marketplace trust, ranking and analytics (20261110110000 –
// 20261110130000). Each is one admin_* RPC that re-checks admin_assert() in
// SQL; a database without the function yet answers an empty read, so the
// pages render (and say so) rather than 500.
import "server-only";
import { supabaseServer } from "@/lib/supabase/server";

export const REPORT_KINDS = ["coach", "review", "user", "post", "comment"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];
export const REPORT_STATUSES = ["open", "reviewed", "dismissed"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export type AdminReport = {
  id: string; kind: ReportKind; reason: string; details: string | null; status: ReportStatus; created_at: string;
  resolved_at: string | null; resolution_note: string | null; reporter_id: string; reporter_name: string;
  target_id: string; target_label: string | null; target_user_id: string | null;
  coach_profile_id: string | null; coach_slug: string | null; coach_status: string | null;
  review_rating: number | null; review_body: string | null; review_status: string | null; open_for_target: number;
};

export type ReportCounts = Partial<Record<"open" | ReportKind | "resolved_7d", number>>;

function missing(code: string | undefined) {
  return code === "PGRST202" || code === "42883";
}

export async function getAdminReports(opts: { kind?: ReportKind | null; status?: ReportStatus | null; coachProfile?: string | null; limit?: number } = {}): Promise<AdminReport[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("admin_reports", {
    p_kind: opts.kind ?? null, p_status: opts.status === undefined ? "open" : opts.status,
    p_coach_profile: opts.coachProfile ?? null, p_limit: opts.limit ?? 100, p_offset: 0,
  });
  if (error) {
    if (!missing(error.code)) console.error("admin_reports:", error.message);
    return [];
  }
  return (data ?? []) as AdminReport[];
}

export async function getReportCounts(): Promise<ReportCounts | null> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("admin_report_counts");
  if (error) {
    if (!missing(error.code)) console.error("admin_report_counts:", error.message);
    return null;
  }
  return (data ?? {}) as ReportCounts;
}

export type AdminMarketplaceAnalytics = {
  tracking_since: string | null;
  coaches: { public: number; verified: number; accepting: number; active: number };
  last30: Record<"directory_views" | "profile_views" | "signups" | "signups_from_profile" | "requests" | "requests_accepted"
    | "bookings" | "bookings_completed" | "coaching_started" | "relationships_ended" | "reviews", number>;
  weekly: { week: string; profile_views: number; signups: number; requests: number; bookings: number; coaching_started: number; reviews: number }[];
  funnel: Record<string, number>;
  sources: { source: string; views: number; signups: number; requests: number }[];
};

export async function getAdminMarketplaceAnalytics(weeks = 12): Promise<AdminMarketplaceAnalytics | null> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("admin_marketplace_analytics", { p_weeks: weeks });
  if (error) {
    if (!missing(error.code)) console.error("admin_marketplace_analytics:", error.message);
    return null;
  }
  return (data ?? null) as AdminMarketplaceAnalytics | null;
}

export type RankRow = {
  ord: number; profile_id: string; slug: string; display_name: string; verified: boolean;
  relevance: number | null; trust: number; quality: number; responsiveness: number; activity: number;
  engagement: number; cold_start: number; placement: number; score: number | string; signals: Record<string, unknown> | null;
};

export async function getAdminRanking(opts: { query?: string | null; city?: string | null; profile?: string | null; limit?: number } = {}): Promise<RankRow[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("admin_coach_ranking", {
    p_query: opts.query || null, p_city: opts.city || null, p_specializations: null,
    p_online: null, p_in_person: null, p_profile: opts.profile ?? null, p_limit: opts.limit ?? 50,
  });
  if (error) {
    if (!missing(error.code)) console.error("admin_coach_ranking:", error.message);
    return [];
  }
  return (data ?? []) as RankRow[];
}
