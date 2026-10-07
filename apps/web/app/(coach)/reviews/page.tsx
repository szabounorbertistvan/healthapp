import Link from "next/link";
import { Suspense } from "react";
import { MarketplaceTabs } from "@/components/marketplace-tabs";
import { getI18n } from "@/lib/i18n/server";
import { getCoachMyReviews } from "@/lib/review-data";
import { getProfile, displayName } from "@/lib/data";
import { CoachReviewsList } from "@/components/coach-reviews";

/**
 * /reviews — what clients say about the coach (20261106100000): the rating as
 * the public sees it, each review with its one answer, and Report. Never
 * edit or delete: a review is the client's. Under (coach), so the layout
 * keeps clients out.
 */
export default async function CoachReviewsPage() {
  const [{ t }, data, profile] = await Promise.all([getI18n(), getCoachMyReviews(), getProfile()]);
  const c = t.coachProfile.reviews.coach;
  return (
    <div className="mx-auto max-w-3xl">
      <Suspense><MarketplaceTabs /></Suspense>
      <header>
        <h1 className="font-display text-2xl font-extrabold tracking-tight sm:text-[28px]">{c.title}</h1>
        <p className="mt-1 max-w-[62ch] text-[13.5px] text-ink-soft">{c.hint}</p>
      </header>
      <div className="mt-5">
        {data ? (
          <CoachReviewsList data={data} coachName={profile ? displayName(profile) : ""} />
        ) : (
          <p className="text-[13.5px] text-ink-faint">
            {t.coachProfile.bookings.availability.noProfile}{" "}
            <Link href="/settings/coach-profile" className="font-semibold text-accent-ink hover:underline">→</Link>
          </p>
        )}
      </div>
    </div>
  );
}
