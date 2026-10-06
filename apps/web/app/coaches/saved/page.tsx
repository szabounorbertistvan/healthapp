import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { APP_NAME } from "@/lib/brand";
import { fill } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import { currentUserId } from "@/lib/supabase/server";
import { getSavedCoaches } from "@/lib/coach-profile-data";
import { toCoachCard } from "@/lib/coach-discovery";
import { CoachCard } from "@/components/coach-discovery/coach-card";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  // a private list: never indexed, never shared
  return { title: `${t.coachProfile.saved.title} | ${APP_NAME}`, robots: { index: false, follow: false } };
}

/**
 * /coaches/saved — the signed-in reader's private shortlist of coaches
 * (coach_saves, 20261102100000), most recently saved first. A static segment,
 * so it wins over /coaches/[slug] ("saved" is a reserved coach slug).
 *
 * Middleware lets /coaches/* through without a session, so this page sends an
 * anonymous visitor to the existing sign-in flow itself. There is no user in
 * the URL and none in the read: search_coaches(p_saved) is always the
 * caller's own list, and a coach who went hidden or suspended is simply not
 * on it. Unsaving keeps the card until the next visit, so a mis-tap can be
 * undone with the same button.
 */
export default async function SavedCoachesPage() {
  const userId = await currentUserId();
  if (!userId) redirect(`/login?${new URLSearchParams({ next: "/coaches/saved" })}`);
  const [{ t, locale }, result] = await Promise.all([getI18n(), getSavedCoaches()]);
  const s = t.coachProfile.saved;
  const cards = result.items.map((row) => toCoachCard(row, locale));

  return (
    <div className="pt-2 sm:pt-6">
      <Link href="/coaches" className="text-[13px] font-semibold text-ink-faint hover:text-ink">← {t.coachProfile.discovery.backToDiscover}</Link>
      <header className="mt-2">
        <h1 className="font-display text-[26px] font-extrabold tracking-tight sm:text-[34px]">{s.title}</h1>
        <p className="mt-1 text-[14px] text-ink-soft">{s.hint}</p>
      </header>

      {cards.length === 0 ? (
        <div className="mt-6 rounded-3xl bg-surface px-6 py-12 text-center" data-testid="saved-coaches-empty">
          <p className="font-display text-lg font-bold">{s.emptyTitle}</p>
          <p className="mx-auto mt-2 max-w-[44ch] text-[14px] text-ink-soft">{s.emptyHint}</p>
          <Link href="/coaches"
            className="mt-5 inline-flex h-11 items-center rounded-2xl bg-accent px-5 font-display text-sm font-bold text-accent-fg hover:opacity-90">
            {s.emptyCta}
          </Link>
        </div>
      ) : (
        <>
          <p className="mt-5 text-[13px] font-semibold text-ink-faint" data-testid="saved-coaches-count">
            {cards.length === 1 ? s.countOne : fill(s.count, { n: cards.length })}
          </p>
          <ul className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(min(100%,270px),1fr))] gap-4" data-testid="saved-coaches">
            {cards.map((card) => <li key={card.href}><CoachCard card={card} signedIn /></li>)}
          </ul>
        </>
      )}
    </div>
  );
}
