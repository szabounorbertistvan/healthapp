import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { APP_NAME } from "@/lib/brand";
import { fill } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import { currentUserId } from "@/lib/supabase/server";
import { getPublicCoachProfile } from "@/lib/coach-profile-data";
import { getMyReviewState } from "@/lib/review-data";
import { ReviewForm } from "@/components/coach-reviews";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const [{ t }, { slug }] = await Promise.all([getI18n(), params]);
  const profile = await getPublicCoachProfile(slug);
  return {
    title: profile ? `${fill(t.coachProfile.reviews.form.title, { name: profile.display_name })} | ${APP_NAME}` : APP_NAME,
    robots: { index: false, follow: false },
  };
}

/**
 * /coaches/[slug]/review — the reader's one review of a coach
 * (20261106100000): write it, edit it, or delete it. Only after a real
 * interaction (my_coach_review_state() says so; submit_coach_review() checks
 * again). Middleware lets /coaches/* through, so the page asks for a sign-in.
 */
export default async function ReviewPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!(await currentUserId())) redirect(`/login?${new URLSearchParams({ next: `/coaches/${slug}/review` })}`);
  const [{ t }, profile] = await Promise.all([getI18n(), getPublicCoachProfile(slug)]);
  if (!profile || profile.slug !== slug) notFound();
  const state = await getMyReviewState(profile.id);
  if (!state) notFound();
  const f = t.coachProfile.reviews.form;
  return (
    <div className="pt-2 sm:pt-6">
      <Link href={`/coaches/${profile.slug}`} className="text-[13px] font-semibold text-ink-faint hover:text-ink">
        ← {fill(f.back, { name: profile.display_name })}
      </Link>
      <header className="mt-2">
        <h1 className="font-display text-[26px] font-extrabold tracking-tight sm:text-[34px]">{fill(f.title, { name: profile.display_name })}</h1>
      </header>
      <div className="mt-5 max-w-2xl">
        <ReviewForm profileId={profile.id} slug={profile.slug} coachName={profile.display_name} state={state} />
      </div>
    </div>
  );
}
