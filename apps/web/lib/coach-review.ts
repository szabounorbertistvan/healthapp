/**
 * Coach reviews for the web app (migration 20261106100000). Pure and
 * client-safe. The numbers — count, average, distribution — come from the
 * database (derived columns kept by a trigger); this file only draws them.
 */

export const REVIEW_ERRORS = [
  "NOT_ELIGIBLE", "CANNOT_REVIEW_SELF", "INVALID_RATING", "REVIEW_TOO_LONG", "REVIEW_HIDDEN",
  "REVIEW_NOT_FOUND", "REVIEW_EXISTS", "RESPONSE_TOO_LONG", "COACH_NOT_FOUND",
  "REASON_REQUIRED", "BAD_TRANSITION", "ADMIN_ONLY",
] as const;
export type ReviewErrorCode = (typeof REVIEW_ERRORS)[number];

export function reviewErrorCode(error: { message: string } | null): ReviewErrorCode | null {
  if (!error) return null;
  return REVIEW_ERRORS.find((code) => error.message.includes(code)) ?? null;
}

export const REVIEW_BODY_MAX = 2000;
export const REVIEW_RESPONSE_MAX = 1000;

export type ReviewStats = {
  count: number;
  average: number | null;
  /** Reviews with 1, 2, 3, 4, 5 stars, in that order. */
  distribution: number[];
};

export type PublicReview = {
  id: string;
  rating: number;
  body: string | null;
  created_at: string;
  edited_at: string | null;
  reviewer_name: string;
  reviewer_avatar: string | null;
  basis: "coaching" | "booking";
  coach_response: string | null;
  coach_response_at: string | null;
  is_mine: boolean;
};

export type PublicReviews = ReviewStats & { items: PublicReview[] };

export type CoachReview = Omit<PublicReview, "is_mine"> & { status: "published" | "hidden" };
export type CoachMyReviews = ReviewStats & { slug: string; items: CoachReview[] };

export type MyReviewState = {
  eligible: boolean;
  basis: "coaching" | "booking" | null;
  review: { id: string; rating: number; body: string | null; status: "published" | "hidden"; created_at: string;
            edited_at: string | null; coach_response: string | null } | null;
};

/** The card's compact signal: "4.9 ★ · 27 reviews" — null when there is nothing to show. */
export function ratingLabel(rating: { average: number | string | null; count: number } | null | undefined,
  words: { one: string; many: string }, locale: "en" | "ro"): string | null {
  if (!rating || rating.count <= 0 || rating.average === null) return null;
  const avg = new Intl.NumberFormat(locale === "ro" ? "ro-RO" : "en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    .format(Number(rating.average));
  return `${avg} ★ · ${rating.count} ${rating.count === 1 ? words.one : words.many}`;
}

/** Each star value's share of the reviews, 5 stars first, as whole percentages for the bars. */
export function distributionBars(distribution: number[]): { stars: number; count: number; pct: number }[] {
  const total = distribution.reduce((a, b) => a + b, 0);
  return [5, 4, 3, 2, 1].map((stars) => {
    const count = distribution[stars - 1] ?? 0;
    return { stars, count, pct: total ? Math.round((count / total) * 100) : 0 };
  });
}
