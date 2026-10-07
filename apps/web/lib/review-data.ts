// Coach review reads (migration 20261106100000). The public reads go through
// coach_public_reviews() — the same door rules as the public page — and the
// aggregates are the profile's derived columns, never computed here.
import "server-only";
import { currentUserId, liveUser, supabasePublic, supabaseServer } from "@/lib/supabase/server";
import type { CoachMyReviews, MyReviewState, PublicReviews } from "./coach-review";

const EMPTY: PublicReviews = { count: 0, average: null, distribution: [0, 0, 0, 0, 0], items: [] };

/** A public coach page's reviews: the aggregates and the newest page of reviews. */
export async function getPublicReviews(slug: string, limit = 10): Promise<PublicReviews> {
  const client = (await currentUserId()) ? await supabaseServer() : supabasePublic();
  const { data, error } = await client.rpc("coach_public_reviews", { p_slug: slug, p_limit: limit, p_offset: 0 });
  // Read on every public page view: a database without the function yet
  // (PGRST202) means "no reviews", not a 500.
  if (error?.code === "PGRST202") return EMPTY;
  if (error) throw new Error(`public reviews: ${error.message}`);
  if (!data) return EMPTY;
  const d = data as PublicReviews;
  return { ...d, average: d.average === null ? null : Number(d.average) };
}

/** Whether the signed-in reader may review this coach, and their own review. */
export async function getMyReviewState(profileId: string): Promise<MyReviewState | null> {
  const live = await liveUser();
  if (!live) return null;
  const { data, error } = await live.supabase.rpc("my_coach_review_state", { p_coach_profile: profileId });
  if (error?.code === "PGRST202") return null;
  if (error) throw new Error(`review state: ${error.message}`);
  return (data ?? null) as MyReviewState | null;
}

/** The signed-in coach's reviews about themselves (published and hidden). */
export async function getCoachMyReviews(): Promise<CoachMyReviews | null> {
  const live = await liveUser();
  if (!live) return null;
  const { data, error } = await live.supabase.rpc("coach_my_reviews");
  if (error) throw new Error(`my reviews: ${error.message}`);
  if (!data) return null;
  const d = data as CoachMyReviews;
  return { ...d, average: d.average === null ? null : Number(d.average) };
}

export type AdminReviewRow = {
  id: string; coach_id: string; coach_name: string; reviewer_id: string; reviewer_name: string;
  rating: number; body: string | null; status: "published" | "hidden" | "deleted"; basis: string;
  coach_response: string | null; moderation_reason: string | null; open_reports: number; created_at: string;
};

/** One coach's reviews (any state), or — without a coach — every review with an open report. */
export async function getAdminReviews(coachUserId: string | null): Promise<AdminReviewRow[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("admin_coach_reviews", { p_coach: coachUserId });
  // the coach queue reads this on every load: no function yet means no reviews, not a broken queue
  if (error?.code === "PGRST202") return [];
  if (error) throw new Error(`admin reviews: ${error.message}`);
  return (data ?? []) as AdminReviewRow[];
}
