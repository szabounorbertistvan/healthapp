import type { CodedResultV1, CoachReviewsV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { respondToReview } from "@/app/review-actions";
import { getCoachMyReviews } from "@/lib/review-data";

// What clients say about the coach — the web's /reviews (coach_my_reviews):
// the rating as the public sees it and each review; POST is the coach's one
// answer to a review (an empty answer removes it). A review is never edited
// or deleted by the coach.
export const dynamic = "force-dynamic";

export const GET = v1Route(async () => apiJson<CoachReviewsV1>(await getCoachMyReviews()));

export const POST = v1Route(async (request) => {
  const b = (await request.json().catch(() => null)) as { reviewId?: unknown; body?: unknown } | null;
  const r = await respondToReview(typeof b?.reviewId === "string" ? b.reviewId : "", typeof b?.body === "string" ? b.body : "");
  return apiJson<CodedResultV1>({ ok: r.ok, message: r.message, errorCode: r.errorCode });
});
