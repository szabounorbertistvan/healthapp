import Link from "next/link";
import { getI18n } from "@/lib/i18n/server";
import { getCoachRequests } from "@/lib/coach-profile-data";
import type { CoachingRequestStatus } from "@/lib/coach-profile";
import { CoachRequestList } from "@/components/coach-requests";

const TABS = ["pending", "accepted", "declined", "all"] as const;
type Tab = (typeof TABS)[number];

/**
 * /requests — the coach's contact requests (20261103100000): pending first,
 * with Accept / Decline; accepted ones with the deliberate "Start coaching"
 * step; declined and the rest for the record. Under (coach), so the layout
 * keeps clients out. The tab lives in the URL (?tab=), plain links.
 */
export default async function RequestsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const [{ t }, { tab: raw }] = await Promise.all([getI18n(), searchParams]);
  const tab: Tab = (TABS as readonly string[]).includes(raw ?? "") ? (raw as Tab) : "pending";
  const r = t.coachProfile.requests;
  const rows = await getCoachRequests(tab === "all" ? null : (tab as CoachingRequestStatus));

  return (
    <div className="mx-auto max-w-3xl">
      <header>
        <h1 className="font-display text-2xl font-extrabold tracking-tight sm:text-[28px]">{r.title}</h1>
        <p className="mt-1 max-w-[62ch] text-[13.5px] text-ink-soft">{r.hint}</p>
      </header>
      <nav aria-label={r.title} className="mt-5 flex flex-wrap gap-1.5">
        {TABS.map((k) => (
          <Link key={k} href={k === "pending" ? "/requests" : `/requests?tab=${k}`} aria-current={tab === k ? "page" : undefined}
            className={`inline-flex h-10 items-center rounded-full px-4 text-[13.5px] font-semibold ${
              tab === k ? "bg-accent text-accent-fg" : "bg-surface text-ink-soft hover:text-ink"}`}>
            {r.tabs[k]}
          </Link>
        ))}
      </nav>
      <div className="mt-4">
        <CoachRequestList rows={rows} />
      </div>
    </div>
  );
}
