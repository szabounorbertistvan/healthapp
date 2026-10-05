"use client";
import { useState } from "react";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import type { CoachPublicProfile, VerificationBadge } from "@/lib/coach-profile";
import { formatPrice } from "@/lib/coach-onboarding";
import { coachFormat, coachWhyPoints, yearsOfExperience } from "@/lib/coach-public";
import { Avatar } from "../social";
import { StartCoachingButton } from "./start-coaching";

/**
 * A coach's page, drawn from exactly the shape coach_public_profile() returns.
 * One component for both places it appears:
 *
 *   /coaches/[slug]   — inside a StartCoachingProvider, with the follow
 *                       button, posts and programs passed in as slots;
 *   the onboarding preview and the read-only view in /settings/coach-profile
 *                     — no provider, so the Start coaching buttons are drawn
 *                       but inert, and the slots are empty.
 *
 * The layout reads its own width (a container query), not the window's: in
 * the wizard's narrow card it is one column, on the public page main column
 * plus a sticky sidebar. Sections with nothing in them are not drawn.
 *
 * One column (phones) is ordered for someone deciding: who → Follow / Start
 * coaching → what they focus on → about → the key facts → services →
 * certifications → programs → posts → why train with them. Wide, the facts
 * move to the sticky sidebar. Reviews do not exist yet; when they do they are
 * one more section here, and they feed "why train with".
 */
export function CoachProfileView({
  profile, follow, posts, programs, live = false,
}: {
  profile: CoachPublicProfile;
  follow?: React.ReactNode;
  /** Whole sections (CoachSection + content), or nothing; the page decides whether there is anything to show. */
  posts?: React.ReactNode;
  programs?: React.ReactNode;
  /** The public page: an empty field is left out, never shown as a "not written yet" placeholder. */
  live?: boolean;
}) {
  const { t, locale } = useI18n();
  const p = t.coachProfile.publicPage;
  const s = t.coachProfile.services;
  const years = yearsOfExperience(profile.coaching_since);
  const cityOf = (l: CoachPublicProfile["locations"][number]) => (locale === "ro" ? l.city : l.city_en);
  const local = <T extends { name_en: string; name_ro: string }>(x: T) => (locale === "ro" ? x.name_ro : x.name_en);
  const format = coachFormat(profile);
  const formats = format === "hybrid" ? [p.hybridLong]
    : format === "online" ? [t.coachProfile.preview.online]
    : format === "in_person" ? [t.coachProfile.preview.inPerson] : [];

  return (
    <div className="@container">
      {/* ---------- hero ---------- */}
      <header>
        <div className="relative aspect-[8/3] w-full overflow-hidden rounded-3xl bg-accent-soft @2xl:aspect-[16/5]">
          {profile.cover_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profile.cover_url} alt="" className="h-full w-full object-cover" />
          ) : (
            <div aria-hidden className="h-full w-full bg-gradient-to-br from-accent-soft via-surface to-accent/30" />
          )}
        </div>

        <div className="relative z-10 -mt-12 px-1 @2xl:-mt-16 @2xl:px-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="rounded-full bg-bg p-1">
              <Avatar name={profile.display_name} url={profile.avatar_url} size="h-24 w-24 @2xl:h-32 @2xl:w-32" />
            </div>
            <div className="hidden flex-wrap items-center gap-2 @2xl:flex">
              {follow}
              <StartCoachingButton />
            </div>
          </div>

          <div className="mt-4">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <h1 className="font-display text-[28px] font-extrabold leading-tight tracking-tight @2xl:text-[40px]">
                {profile.display_name}
              </h1>
              <VerifiedBadges badges={profile.badges} />
            </div>
            {profile.username ? <p className="mt-0.5 text-[14px] text-ink-faint">@{profile.username}</p> : null}
            {profile.headline ? (
              <p className="mt-1.5 text-[16px] text-ink-soft @2xl:text-[18px]">{profile.headline}</p>
            ) : live ? null : (
              <p className="mt-1.5 text-[16px] italic text-ink-faint">{t.coachProfile.preview.noHeadline}</p>
            )}

            <ul className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13.5px] text-ink-soft">
              {profile.locations[0] && profile.in_person ? (
                <li className="flex items-center gap-1.5"><Dot />{profile.locations.map(cityOf).join(" · ")}</li>
              ) : null}
              {formats.length ? <li className="flex items-center gap-1.5"><Dot />{formats.join(" · ")}</li> : null}
              {years ? <li className="flex items-center gap-1.5"><Dot />{fill(p.yearsShort, { n: years })}</li> : null}
              <li className="flex items-center gap-1.5">
                <Dot /><span className="font-semibold text-ink">{profile.followers}</span> {p.followers.toLowerCase()}
              </li>
            </ul>

            <p
              className={`mt-4 inline-flex items-center gap-2 rounded-full px-3 py-1 text-[12.5px] font-semibold ${
                profile.accepting_clients ? "bg-accent-soft text-accent-ink" : "bg-bg text-ink-faint"
              }`}
            >
              <span aria-hidden className={`h-2 w-2 rounded-full ${profile.accepting_clients ? "bg-accent" : "bg-ink-faint"}`} />
              {profile.accepting_clients ? p.accepting : p.notAccepting}
            </p>

            {/* phones and narrow containers: the actions under the name */}
            <div className="mt-5 flex flex-wrap gap-2 @2xl:hidden">
              <StartCoachingButton className="flex-1" />
              {follow}
            </div>
          </div>
        </div>
      </header>

      {/* ---------- body: main + sidebar ---------- */}
      <div className="mt-10 grid gap-10 @4xl:grid-cols-[minmax(0,1fr)_320px] @4xl:gap-12">
        <div className="min-w-0 space-y-12">
          {profile.specializations.length > 0 ? (
            <Section title={p.specializations}>
              <ul className="flex flex-wrap gap-2">
                {profile.specializations.map((sp) => (
                  <li
                    key={sp.slug}
                    className={`rounded-full px-3.5 py-1.5 text-[13.5px] font-semibold ${sp.is_primary ? "bg-accent text-accent-fg" : "bg-surface text-ink"}`}
                  >
                    {local(sp)}
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
          <About profile={profile} live={live} />

          {/* one column: the facts right after About; wide: they live in the sidebar */}
          <div className="@4xl:hidden">
            <Facts profile={profile} formats={formats} years={years} />
          </div>

          {profile.services.length > 0 ? (
            <Section title={p.services} id="services">
              <ul className="grid gap-3 @xl:grid-cols-2" data-testid="coach-public-services">
                {profile.services.map((sv) => {
                  const price = sv.price_public ? formatPrice(sv.price_cents, sv.currency, locale) : null;
                  return (
                    <li key={sv.id} className="flex flex-col rounded-3xl bg-surface p-5">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{s.kinds[sv.kind]}</p>
                      <p className="mt-1 font-display text-lg font-bold tracking-tight">{sv.name}</p>
                      {sv.description ? <p className="mt-1.5 text-[14px] leading-relaxed text-ink-soft">{sv.description}</p> : null}
                      <p className="mt-4 font-display text-[22px] font-extrabold tracking-tight" data-testid="coach-service-price">
                        {price ? (
                          <>
                            {price}
                            {s.unitShort[sv.price_unit] ? (
                              <span className="ml-1 text-[14px] font-semibold text-ink-soft">{s.unitShort[sv.price_unit]}</span>
                            ) : null}
                          </>
                        ) : (
                          <span className="text-[15px] font-semibold text-ink-soft">{sv.price_public ? s.onRequest : s.priceHidden}</span>
                        )}
                      </p>
                      <div className="mt-auto pt-4">
                        <StartCoachingButton serviceId={sv.id} compact soft className="w-full" />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Section>
          ) : null}

          {profile.certifications.length > 0 ? (
            <Section title={p.certifications}>
              <ul className="divide-y divide-line">
                {profile.certifications.map((c, i) => (
                  <li key={`${c.name}-${i}`} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0">
                    <div>
                      <p className="font-semibold">{c.name}</p>
                      <p className="text-[13px] text-ink-faint">{[c.issuer, c.year].filter(Boolean).join(" · ")}</p>
                    </div>
                    {/* verified only when an admin approved it — existence alone earns no badge */}
                    {c.verified ? (
                      <span className="rounded-full bg-accent-soft px-2.5 py-1 text-[11.5px] font-semibold text-accent-ink">
                        ✓ {p.verified}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          {/* whole sections from the page (CoachSection), streamed for a signed-in reader */}
          {programs}
          {posts}

          <WhyCoach profile={profile} follow={follow} />
        </div>

        <aside className="hidden @4xl:sticky @4xl:top-6 @4xl:block @4xl:self-start">
          <Facts profile={profile} formats={formats} years={years} />
          <div className="mt-4">
            <StartCoachingButton className="w-full" />
          </div>
        </aside>
      </div>
    </div>
  );
}

/** The onboarding preview: the same page, from the draft, with nothing live. */
export function CoachProfilePreview({ profile }: { profile: CoachPublicProfile }) {
  return <CoachProfileView profile={profile} />;
}

function Dot() {
  return <span aria-hidden className="h-1 w-1 rounded-full bg-ink-faint" />;
}

/** A titled block of the coach page; exported for the sections the page builds itself (programs, posts). */
export function CoachSection({ title, id, children }: { title: string; id?: string; children: React.ReactNode }) {
  return <Section title={title} id={id}>{children}</Section>;
}

function Section({ title, id, children }: { title: string; id?: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-label={title}>
      <h2 className="font-display text-xl font-bold tracking-tight">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function VerifiedBadges({ badges }: { badges: VerificationBadge[] }) {
  const { t } = useI18n();
  const p = t.coachProfile.publicPage;
  if (badges.length === 0) return null;
  const label: Record<VerificationBadge, string> = {
    identity_verified: p.verifiedIdentity,
    certification_verified: p.verifiedCertification,
    business_verified: p.verifiedBusiness,
  };
  return (
    <ul className="flex flex-wrap gap-1.5">
      {badges.map((b) => (
        <li key={b} title={label[b]} className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2.5 py-1 text-[11.5px] font-semibold text-accent-ink">
          ✓ {label[b]}
        </li>
      ))}
    </ul>
  );
}

/** About, folded after a few lines so a long story does not push Services off the screen. */
function About({ profile, live }: { profile: CoachPublicProfile; live: boolean }) {
  const { t } = useI18n();
  const p = t.coachProfile.publicPage;
  const [open, setOpen] = useState(false);
  const text = profile.about?.trim();
  if (!text && live) return null;
  const long = (text?.length ?? 0) > 420 || (text?.split("\n").length ?? 0) > 5;
  return (
    <Section title={p.aboutMe}>
      {text ? (
        <>
          <p className={`whitespace-pre-line text-[15px] leading-relaxed text-ink-soft ${long && !open ? "line-clamp-5" : ""}`}>
            {text}
          </p>
          {long ? (
            <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
              className="mt-2 text-[13.5px] font-semibold text-accent-ink hover:underline">
              {open ? p.readLess : p.readMore}
            </button>
          ) : null}
        </>
      ) : (
        <p className="text-[15px] italic text-ink-faint">{t.coachProfile.preview.noAbout}</p>
      )}
    </Section>
  );
}

/** The sidebar: the facts people scan for, and the social proof the coach's privacy allows. */
function Facts({ profile, formats, years }: { profile: CoachPublicProfile; formats: string[]; years: number | null }) {
  const { t, locale } = useI18n();
  const p = t.coachProfile.publicPage;
  const rows: { label: string; value: React.ReactNode }[] = [];
  if (years || profile.coaching_since) {
    rows.push({
      label: p.experience,
      value: [years ? fill(p.yearsShort, { n: years }) : null, profile.coaching_since ? fill(p.since, { year: profile.coaching_since }) : null]
        .filter(Boolean).join(" · "),
    });
  }
  if (formats.length) rows.push({ label: p.format, value: formats.join(" · ") });
  if (profile.languages.length) rows.push({ label: p.languages, value: profile.languages.map((l) => l.native_name).join(" · ") });
  if (profile.in_person && profile.locations.length) {
    rows.push({
      label: p.locations,
      value: (
        <ul className="grid gap-0.5">
          {profile.locations.map((l) => (
            <li key={l.city_slug}>
              {locale === "ro" ? l.city : l.city_en}
              {l.gym_name ? <span className="text-ink-faint"> — {l.gym_name}</span> : null}
            </li>
          ))}
        </ul>
      ),
    });
  }

  const stats: { label: string; value: number }[] = [{ label: p.followers, value: profile.followers }];
  if (profile.stats) {
    // A zero is not social proof: only figures that say something are shown (followers always).
    if (profile.stats.posts > 0) stats.push({ label: p.publicPosts, value: profile.stats.posts });
    if (profile.stats.programs) stats.push({ label: p.publicPrograms, value: profile.stats.programs });
    if (profile.stats.workouts) stats.push({ label: p.workouts, value: profile.stats.workouts });
    if (profile.stats.badges) stats.push({ label: p.badges, value: profile.stats.badges });
    if (profile.stats.fitness_score) stats.push({ label: p.fitnessScore, value: profile.stats.fitness_score });
  }

  return (
    <div className="rounded-3xl bg-surface p-5">
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{p.facts}</h2>
      {rows.length ? (
        <dl className="mt-3 grid gap-3">
          {rows.map((r) => (
            <div key={r.label}>
              <dt className="text-[12px] font-semibold text-ink-faint">{r.label}</dt>
              <dd className="mt-0.5 text-[14px] text-ink">{r.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-4">
        {stats.map((st) => (
          <div key={st.label} className="flex flex-col-reverse">
            <dt className="text-[12px] text-ink-faint">{st.label}</dt>
            <dd className="font-display text-xl font-extrabold tabular-nums">{st.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * The closing argument, for the reader who scrolled this far: only facts the
 * profile has (coachWhyPoints — no ratings, client counts or success rates,
 * none of which Voinic tracks), then the one real next step, Start coaching
 * (a request the coach accepts; no payment). A coach who is full gets Follow
 * instead of a dead button.
 */
function WhyCoach({ profile, follow }: { profile: CoachPublicProfile; follow?: React.ReactNode }) {
  const { t, locale } = useI18n();
  const p = t.coachProfile.publicPage;
  const name = profile.display_name;
  const specName = (slug: string) => {
    const s = profile.specializations.find((x) => x.slug === slug);
    return s ? (locale === "ro" ? s.name_ro : s.name_en) : slug;
  };
  const lines = coachWhyPoints(profile).map((pt) => {
    switch (pt.kind) {
      case "verified": return p.whyVerified;
      case "experience": return fill(p.whyExperience, { n: pt.years });
      case "since": return fill(p.whySince, { year: pt.year });
      case "focus": return fill(p.whyFocus, { list: pt.slugs.map(specName).join(", ") });
      case "services": return pt.n === 1 ? p.whyServicesOne : fill(p.whyServices, { n: pt.n });
      case "programs": return pt.n === 1 ? p.whyProgramsOne : fill(p.whyPrograms, { n: pt.n });
      case "posts": return fill(p.whyPosts, { n: pt.n });
    }
  });

  return (
    <section aria-labelledby="why-coach" data-testid="coach-why" className="rounded-3xl bg-surface p-6 @2xl:p-8">
      <h2 id="why-coach" className="font-display text-[22px] font-extrabold leading-tight tracking-tight @2xl:text-[26px]">
        {fill(p.whyTitle, { name })}
      </h2>
      {lines.length > 0 ? (
        <ul className="mt-5 grid gap-2.5 @xl:grid-cols-2">
          {lines.map((line) => (
            <li key={line} className="flex items-start gap-2.5 text-[14.5px]">
              <span aria-hidden className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-bold text-accent-fg">✓</span>
              {line}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mt-5 max-w-[60ch] text-[13.5px] text-ink-soft">
        {fill(profile.accepting_clients ? p.whyHint : p.whyFull, { name })}
      </p>
      <div className="mt-5 flex flex-wrap gap-2">
        {profile.accepting_clients ? <StartCoachingButton /> : null}
        {follow}
      </div>
    </section>
  );
}
