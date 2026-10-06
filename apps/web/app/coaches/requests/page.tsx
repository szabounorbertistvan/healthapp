import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { APP_NAME } from "@/lib/brand";
import { getI18n } from "@/lib/i18n/server";
import { currentUserId } from "@/lib/supabase/server";
import { getMyCoachingRequests } from "@/lib/coach-profile-data";
import { MyRequestList } from "@/components/coach-requests";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: `${t.coachProfile.requests.mine.title} | ${APP_NAME}`, robots: { index: false, follow: false } };
}

/**
 * /coaches/requests — the coaches the reader contacted (20261103100000),
 * pending first: status, service, date, message, cancel while pending, and
 * what happens next once accepted. A static segment ("requests" is not a coach
 * slug a profile can take: the route wins). Middleware lets /coaches/* through
 * without a session, so the page sends anonymous visitors to sign in itself.
 */
export default async function MyRequestsPage() {
  if (!(await currentUserId())) redirect(`/login?${new URLSearchParams({ next: "/coaches/requests" })}`);
  const [{ t }, rows] = await Promise.all([getI18n(), getMyCoachingRequests()]);
  const m = t.coachProfile.requests.mine;
  return (
    <div className="pt-2 sm:pt-6">
      <Link href="/coaches" className="text-[13px] font-semibold text-ink-faint hover:text-ink">← {t.coachProfile.discovery.backToDiscover}</Link>
      <header className="mt-2">
        <h1 className="font-display text-[26px] font-extrabold tracking-tight sm:text-[34px]">{m.title}</h1>
        <p className="mt-1 text-[14px] text-ink-soft">{m.hint}</p>
      </header>
      <div className="mt-5 max-w-3xl">
        <MyRequestList rows={rows} />
      </div>
    </div>
  );
}
