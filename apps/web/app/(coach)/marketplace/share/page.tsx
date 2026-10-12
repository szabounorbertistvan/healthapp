import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { getI18n } from "@/lib/i18n/server";
import { APP_NAME, SITE_URL } from "@/lib/brand";
import { getMyCoachProfile, getPublicCoachProfile } from "@/lib/coach-profile-data";
import { coachShareCardFromPublic } from "@/lib/coach-share-card";
import { MarketplaceTabs } from "@/components/marketplace-tabs";
import { BecomeCoachCard } from "@/components/coach-profile/status";
import { CoachShareGenerator } from "@/components/coach-share-generator";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: `${t.coachProfile.shareCard.title} | ${APP_NAME}`, robots: { index: false, follow: false } };
}

/**
 * /marketplace/share — the coach's share-card generator. Coach-only (the
 * (coach) layout sends anyone else away) and always about the signed-in
 * coach: the slug comes from their own profile row, never from the URL, and
 * the card's data from coach_public_profile() — what anyone can already see
 * on /coaches/<slug>. A profile that is not public has no page to link to,
 * so the generator explains that instead of making a card that leads to a 404.
 */
export default async function ShareCardPage() {
  const [{ t }, mine] = await Promise.all([getI18n(), getMyCoachProfile()]);
  const s = t.coachProfile.shareCard;
  const head = (
    <>
      <Suspense><MarketplaceTabs /></Suspense>
      <h1 className="font-display text-2xl font-extrabold tracking-tight sm:text-[28px]">{s.title}</h1>
    </>
  );
  if (!mine) {
    return <div className="mx-auto max-w-3xl">{head}<div className="mt-5"><BecomeCoachCard /></div></div>;
  }
  const pub = mine.profile.status === "published" ? await getPublicCoachProfile(mine.profile.slug) : null;
  if (!pub) {
    return (
      <div className="mx-auto max-w-3xl">
        {head}
        <section className="mt-5 rounded-3xl bg-surface p-6" data-testid="share-not-public">
          <h2 className="font-display text-[18px] font-bold">{s.notPublicTitle}</h2>
          <p className="mt-1.5 max-w-[60ch] text-[13.5px] text-ink-soft">{s.notPublicBody}</p>
          <Link href="/settings/coach-profile" className="mt-4 inline-flex h-11 items-center rounded-2xl bg-accent px-5 font-display text-sm font-bold text-accent-fg hover:opacity-90">
            {s.notPublicCta}
          </Link>
        </section>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-5xl">
      {head}
      <p className="mb-6 mt-1 max-w-[66ch] text-[13.5px] text-ink-soft">{s.intro}</p>
      <CoachShareGenerator card={coachShareCardFromPublic(pub, SITE_URL)} />
    </div>
  );
}
