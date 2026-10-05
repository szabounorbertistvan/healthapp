import Link from "next/link";
import { getI18n } from "@/lib/i18n/server";

/**
 * notFound() from /coaches/[slug]: no such slug, or a profile that is not
 * public (draft, in review, suspended, a deleted account, or a coach who
 * blocked the reader) — deliberately the same page for all of them, so it
 * says nothing about which. The way out is Coach Discovery.
 */
export default async function CoachNotFound() {
  const { t } = await getI18n();
  const p = t.coachProfile.publicPage;
  return (
    <div className="mx-auto max-w-xl py-16 text-center sm:py-24" data-testid="coach-not-found">
      <h1 className="font-display text-[28px] font-extrabold tracking-tight sm:text-[36px]">{p.notFoundTitle}</h1>
      <p className="mx-auto mt-3 max-w-[44ch] text-[15px] text-ink-soft">{p.notFoundBody}</p>
      <Link href="/coaches"
        className="mt-7 inline-flex h-12 items-center rounded-2xl bg-accent px-6 font-display text-sm font-bold text-accent-fg hover:opacity-90">
        {p.backToDiscovery}
      </Link>
    </div>
  );
}
