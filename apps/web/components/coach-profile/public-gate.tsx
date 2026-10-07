import Link from "next/link";
import { fill } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import { APP_NAME } from "@/lib/brand";
import { Logo } from "@/components/logo";

/**
 * The public coach page's way in (20261107100000). A server component — plain
 * links, no JavaScript — under the coach's services, never an overlay:
 *
 *   anonymous   "See the full profile": what an account adds, one line on
 *               what Voinic is (most visitors arrive from a coach's Instagram
 *               bio and have never heard of it), Create a free account /
 *               I already have one — both coming back to this exact page.
 *   incomplete  signed in through Google without a username yet: finish the
 *               profile, then back here (contacting and booking need one).
 */
export async function PublicProfileGate({ kind, coachName, moreServices, signupHref, signinHref }: {
  kind: "anonymous" | "incomplete";
  coachName: string;
  moreServices: number;
  signupHref: string;
  signinHref: string | null;
}) {
  const { t } = await getI18n();
  const g = t.coachProfile.publicPage.gate;
  return (
    <section aria-label={kind === "anonymous" ? g.title : g.completeTitle} data-testid="profile-gate" data-kind={kind}
      className="rounded-3xl bg-surface p-5 sm:p-6">
      <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-ink-faint">
        <Logo size="sm" />
      </div>
      <h2 className="mt-3 font-display text-xl font-bold tracking-tight">{kind === "anonymous" ? g.title : g.completeTitle}</h2>
      <p className="mt-1.5 text-[14px] leading-relaxed text-ink-soft">
        {fill(kind === "anonymous" ? g.body : g.completeBody, { name: coachName })}
      </p>
      {moreServices > 0 ? (
        <p className="mt-1.5 text-[13.5px] font-semibold text-ink" data-testid="gate-more-services">
          {fill(moreServices === 1 ? g.moreService : g.moreServices, { n: moreServices })}
        </p>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <Link href={signupHref} data-testid="gate-signup"
          className="inline-flex h-11 items-center justify-center rounded-2xl bg-accent px-5 font-display text-sm font-bold text-accent-fg hover:opacity-90">
          {kind === "anonymous" ? g.signup : g.completeCta}
        </Link>
        {signinHref ? (
          <Link href={signinHref} data-testid="gate-signin"
            className="inline-flex h-11 items-center justify-center rounded-2xl bg-bg px-5 text-sm font-semibold text-ink hover:bg-accent-soft/60">
            {g.signin}
          </Link>
        ) : null}
      </div>
      {kind === "anonymous" ? (
        <p className="mt-4 border-t border-line pt-3 text-[12.5px] leading-relaxed text-ink-faint">{fill(g.aboutVoinic, { app: APP_NAME })}</p>
      ) : null}
    </section>
  );
}
