"use client";
import { useRef, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import type { CoachPublicProfile, VerificationBadge } from "@/lib/coach-profile";
import { formatPrice } from "@/lib/coach-onboarding";
import { coachFormat, coachWhyPoints, fullSizeAvatarUrl, yearsOfExperience, type TeaserCut } from "@/lib/coach-public";
import { gymMapHref } from "@/lib/gym-map";
import { Avatar } from "../social";
import { StartCoachingButton } from "./start-coaching";
import { VerifiedBadge } from "../coach-discovery/verified-badge";
import { useServiceDuration } from "./service-format";
import { socialEntries } from "@/lib/coach-content";

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
 * Ordered for someone deciding (20261111100000): who (header: rating, place,
 * format, next free slot, the actions) → about → specializations and who
 * they work with → coaching approach and experience (the coach's own words,
 * labelled so) → services → credentials and verification (Voinic's word
 * kept apart from the coach's) → availability → reviews → programs → posts
 * → why train with them. Wide, the key facts sit in a sticky sidebar.
 */
export function CoachProfileView({
  profile, follow, posts, programs, live = false, bookHrefs, reviews, gate, headerRating, share, availability, teaser,
}: {
  profile: CoachPublicProfile;
  follow?: React.ReactNode;
  /** Whole sections (CoachSection + content), or nothing; the page decides whether there is anything to show. */
  posts?: React.ReactNode;
  programs?: React.ReactNode;
  /** The public page: an empty field is left out, never shown as a "not written yet" placeholder. */
  live?: boolean;
  /** Bookable services (20261105100000): service id → its booking page. Absent: no Book button. */
  bookHrefs?: Record<string, string>;
  /** The Reviews section (20261106100000), a whole CoachSection or nothing; after the offer. */
  reviews?: React.ReactNode;
  /** The anonymous visitor's way in (20261107100000), after the services. */
  gate?: React.ReactNode;
  /** "4.9 ★ · 27 reviews" from the database, linked to the section; null when there are none. */
  headerRating?: string | null;
  /** The Share button (the public page only). */
  share?: React.ReactNode;
  /**
   * The next free slot, already formatted on the server in the coach's zone
   * (so server and browser render the same text), and where to see every
   * time. Null: no Availability section (a preview, or a database without it).
   */
  availability?: { bookable: boolean; nextSlot: string | null; zone: string | null; href: string | null } | null;
  /**
   * An anonymous visitor's page (coachTeaser): which own-words texts were cut
   * on the server, and where the rest is (sign up, back to this page). Each cut
   * text ends in a link saying so, instead of an ellipsis that leads nowhere.
   */
  teaser?: { cut: TeaserCut; href: string } | null;
}) {
  const { t, locale } = useI18n();
  const p = t.coachProfile.publicPage;
  const s = t.coachProfile.services;
  const years = yearsOfExperience(profile.coaching_since);
  const durationText = useServiceDuration();
  const v = t.coachProfile.verification;
  const today = new Date().toISOString().slice(0, 10);
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
              <ProfilePhoto name={profile.display_name} url={profile.avatar_url} />
            </div>
            <div className="hidden flex-wrap items-center gap-2 @2xl:flex">
              {follow}
              {share}
              <StartCoachingButton />
            </div>
          </div>

          <div className="mt-4">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <h1 className="font-display text-[28px] font-extrabold leading-tight tracking-tight @2xl:text-[40px]">
                {profile.display_name}
              </h1>
              <VerifiedBadge verified={profile.verified} size="md" />
            </div>
            {profile.username ? <p className="mt-0.5 text-[14px] text-ink-faint">@{profile.username}</p> : null}
            <VerifiedDetail profile={profile} />
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
              {availability?.nextSlot ? (
                <li className="flex items-center gap-1.5" data-testid="coach-header-next-slot">
                  <Dot /><a href="#availability" className="font-semibold text-ink hover:text-accent-ink">{fill(p.nextSlot, { when: availability.nextSlot })}</a>
                </li>
              ) : null}
              {headerRating ? (
                <li className="flex items-center gap-1.5" data-testid="coach-header-rating">
                  <Dot /><a href="#reviews" className="font-semibold text-ink hover:text-accent-ink">{headerRating}</a>
                </li>
              ) : null}
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
              {share}
            </div>
          </div>
        </div>
      </header>

      {/* ---------- body: main + sidebar ---------- */}
      <div className="mt-10 grid gap-10 @4xl:grid-cols-[minmax(0,1fr)_320px] @4xl:gap-12">
        <div className="min-w-0 space-y-12">
          <About profile={profile} live={live} teaser={teaser ?? null} />

          {profile.specializations.length > 0 || (profile.client_goals?.length ?? 0) > 0 ? (
            <Section title={p.specializations} id="specializations">
              <ul className="flex flex-wrap gap-2">
                {profile.specializations.map((sp) => (
                  <li key={sp.slug}>
                    <SpecializationChip slug={sp.slug} name={local(sp)} primary={sp.is_primary} />
                  </li>
                ))}
              </ul>
              {profile.client_goals?.length ? (
                <div className="mt-5" data-testid="coach-client-goals-public">
                  <h3 className="text-[12px] font-semibold uppercase tracking-wider text-ink-faint">{p.goalsTitle}</h3>
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {profile.client_goals.map((g) => (
                      <li key={g} className="rounded-full bg-bg px-3 py-1 text-[13px] font-semibold text-ink-soft">
                        {t.coachProfile.expertise.goals[g]}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </Section>
          ) : null}

          <Approach profile={profile} teaser={teaser ?? null} />

          {profile.services.length > 0 ? (
            <Section title={p.services} id="services">
              <ul className="grid gap-3 @xl:grid-cols-2" data-testid="coach-public-services">
                {profile.services.map((sv) => {
                  const price = sv.price_public ? formatPrice(sv.price_cents, sv.currency, locale) : null;
                  const duration = durationText(sv.duration_value ?? null, sv.duration_unit ?? null);
                  return (
                    <li key={sv.id} className="flex flex-col rounded-3xl bg-surface p-5" data-testid="coach-public-service">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{s.kinds[sv.kind]}</p>
                      <p className="mt-1 font-display text-lg font-bold tracking-tight">{sv.name}</p>
                      {/* how and how long — the two things people ask before the price */}
                      <ul className="mt-2 flex flex-wrap gap-1.5">
                        {sv.delivery ? (
                          <li className="rounded-full bg-bg px-2.5 py-1 text-[12px] font-semibold text-ink-soft">{s.deliveries[sv.delivery]}</li>
                        ) : null}
                        {duration ? (
                          <li className="rounded-full bg-bg px-2.5 py-1 text-[12px] font-semibold text-ink-soft">{duration}</li>
                        ) : null}
                      </ul>
                      {sv.description ? <p className="mt-2 text-[14px] leading-relaxed text-ink-soft">{sv.description}</p> : null}
                      <p className="mt-4 font-display text-[22px] font-extrabold tracking-tight" data-testid="coach-service-price">
                        {sv.price_unit === "free" ? (
                          <span>{s.free}</span>
                        ) : price ? (
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
                      <div className="mt-auto grid gap-2 pt-4">
                        {bookHrefs?.[sv.id] ? (
                          <a href={bookHrefs[sv.id]} data-testid="book-service" data-mkt="cta_book"
                            className="inline-flex h-10 w-full items-center justify-center rounded-2xl bg-accent px-4 font-display text-[13.5px] font-bold text-accent-fg hover:opacity-90">
                            {t.coachProfile.bookings.book.cta}
                          </a>
                        ) : null}
                        <StartCoachingButton serviceId={sv.id} compact soft className="w-full" />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Section>
          ) : null}

          {gate}

          {profile.certifications.length > 0 || profile.verified ? (
            <Section title={p.credentialsTitle} id="credentials">
              {profile.verified ? (
                <p className="mb-4 flex flex-wrap items-center gap-2 text-[14px]" data-testid="credentials-verified">
                  <VerifiedBadge verified size="md" />
                  <span className="text-ink-soft"><VerifiedDetailText profile={profile} /></span>
                </p>
              ) : null}
              {profile.certifications.length > 0 ? (
                <>
                  <p className="-mt-1 mb-3 text-[13px] text-ink-faint">{v.credentialsNote}</p>
                  <ul className="divide-y divide-line">
                    {profile.certifications.map((c, i) => (
                      <li key={`${c.name}-${i}`} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0">
                        <div>
                          <p className="font-semibold">{c.name}</p>
                          <p className="text-[13px] text-ink-faint">{[c.issuer, c.year].filter(Boolean).join(" · ")}</p>
                        </div>
                        {/* Voinic's word only when an admin verified this credential; otherwise it is the coach's */}
                        <span className="flex flex-wrap items-center gap-1.5" data-testid="public-credential" data-verified={c.verified}>
                          {c.expires_on && c.expires_on < today ? (
                            <span className="rounded-full bg-risk-soft px-2.5 py-1 text-[11.5px] font-semibold text-risk">{v.credentialExpired}</span>
                          ) : null}
                          {c.verified ? (
                            <span className="rounded-full bg-accent-soft px-2.5 py-1 text-[11.5px] font-semibold text-accent-ink">✓ {v.credentialVerified}</span>
                          ) : (
                            <span className="rounded-full bg-bg px-2.5 py-1 text-[11.5px] font-semibold text-ink-faint">{v.credentialProvided}</span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </Section>
          ) : null}

          {live && availability ? <Availability profile={profile} availability={availability} /> : null}

          {reviews}

          {/* one column: where and how after the offer; wide: the facts live in the sidebar */}
          <div className="@4xl:hidden">
            <Facts profile={profile} formats={formats} years={years} />
          </div>

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

/**
 * Under the name of a verified coach: what Voinic checked (certifications /
 * business, when recorded; never identity — see VerifiedDetailText) — one quiet line, never more
 * badges. Nothing for anyone else.
 */
function VerifiedDetail({ profile }: { profile: CoachPublicProfile }) {
  if (!profile.verified) return null;
  return (
    <p className="mt-1.5 text-[12.5px] text-ink-faint" data-testid="voinic-verified-detail">
      <VerifiedDetailText profile={profile} />
    </p>
  );
}

/** What Voinic checked, as one line of text (the header shows it under the name; the credentials section beside the badge). */
function VerifiedDetailText({ profile }: { profile: CoachPublicProfile }) {
  const { t } = useI18n();
  const p = t.coachProfile.publicPage;
  const v = t.coachProfile.verification;
  const label: Record<VerificationBadge, string> = {
    identity_verified: p.verifiedIdentity,
    certification_verified: p.verifiedCertification,
    business_verified: p.verifiedBusiness,
  };
  // no identity claim: Voinic has no identity-verification procedure (20261119100000); the database
  // already leaves the badge out, this keeps a stale payload from showing it
  const badges = profile.badges.filter((b) => b !== "identity_verified");
  return <>{badges.length ? `${v.checked} ${badges.map((b) => label[b].toLowerCase()).join(" · ")}` : v.badgeHint}</>;
}

/**
 * How they coach and what they have done — the coach's own words, said so:
 * nothing here is checked by Voinic (credentials and the badge are, above).
 */
function Approach({ profile, teaser }: { profile: CoachPublicProfile; teaser: { cut: TeaserCut; href: string } | null }) {
  const { t } = useI18n();
  const p = t.coachProfile.publicPage;
  const approach = profile.approach?.trim();
  const experience = profile.experience_summary?.trim();
  if (!approach && !experience) return null;
  return (
    <Section title={p.approachTitle} id="approach">
      <div className="grid gap-5" data-testid="coach-approach">
        {approach ? (
          <div>
            <p className="whitespace-pre-line text-[15px] leading-relaxed text-ink-soft">{approach}</p>
            {teaser?.cut.approach ? <GatedMore href={teaser.href} /> : null}
          </div>
        ) : null}
        {experience ? (
          <div>
            <h3 className="text-[12px] font-semibold uppercase tracking-wider text-ink-faint">{p.experienceTitle}</h3>
            <p className="mt-2 whitespace-pre-line text-[15px] leading-relaxed text-ink-soft">{experience}</p>
            {teaser?.cut.experience ? <GatedMore href={teaser.href} /> : null}
          </div>
        ) : null}
        <p className="text-[12.5px] text-ink-faint">{fill(p.ownWords, { name: profile.display_name })}</p>
      </div>
    </Section>
  );
}

/** When the coach can be booked: the next free slot (in their zone, named) and the way to every time, or how sessions are arranged. */
function Availability({ profile, availability }: {
  profile: CoachPublicProfile;
  availability: { bookable: boolean; nextSlot: string | null; zone: string | null; href: string | null };
}) {
  const { t } = useI18n();
  const p = t.coachProfile.publicPage;
  return (
    <Section title={p.availabilityTitle} id="availability">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-3xl bg-surface p-5" data-testid="coach-availability"
        data-bookable={availability.bookable}>
        <div>
          {availability.bookable ? (
            <>
              <p className="font-display text-lg font-bold">
                {availability.nextSlot ? fill(p.nextSlot, { when: availability.nextSlot }) : p.noSlotsSoon}
              </p>
              {availability.zone ? <p className="mt-0.5 text-[13px] text-ink-faint">{fill(p.timesIn, { zone: availability.zone })}</p> : null}
            </>
          ) : (
            <p className="text-[14.5px] text-ink-soft">{fill(p.notBookable, { name: profile.display_name })}</p>
          )}
        </div>
        {availability.bookable && availability.href ? (
          <a href={availability.href} data-mkt="cta_book" data-testid="availability-book"
            className="inline-flex h-11 items-center rounded-2xl bg-accent px-5 font-display text-[14px] font-bold text-accent-fg hover:opacity-90">
            {p.seeTimes}
          </a>
        ) : !availability.bookable && profile.accepting_clients ? <StartCoachingButton /> : null}
      </div>
    </Section>
  );
}

/** About, folded after a few lines so a long story does not push Services off the screen. */
function About({ profile, live, teaser }: { profile: CoachPublicProfile; live: boolean; teaser: { cut: TeaserCut; href: string } | null }) {
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
          {teaser?.cut.about ? (
            <GatedMore href={teaser.href} />
          ) : long ? (
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
  if (profile.certifications.length) {
    // provided by the coach vs checked by Voinic, never blurred into one number
    const checked = profile.certifications.filter((c) => c.verified).length;
    rows.push({
      label: t.coachProfile.verification.credentialsRow,
      value: [fill(t.coachProfile.verification.credentialsAdded, { n: profile.certifications.length }),
              checked ? fill(t.coachProfile.verification.credentialsChecked, { n: checked }) : null].filter(Boolean).join(" · "),
    });
  }
  const links = socialEntries(profile.social_links);
  if (links.length) {
    rows.push({
      label: fill(p.findMe, { name: profile.display_name }),
      value: (
        <ul className="flex flex-wrap gap-x-3 gap-y-1" data-testid="coach-social-links-public">
          {links.map((l) => (
            <li key={l.network}>
              {/* the coach's own pages: rel=me for identity, nofollow because Voinic does not vouch for them */}
              <a href={l.url} target="_blank" rel="me nofollow noopener noreferrer" className="font-semibold text-accent-ink hover:underline">
                {t.coachProfile.identity.socialNetworks[l.network]}
              </a>
            </li>
          ))}
        </ul>
      ),
    });
  }
  if (profile.in_person && profile.locations.length) {
    rows.push({
      label: p.locations,
      value: (
        <ul className="grid gap-0.5">
          {profile.locations.map((l) => (
            <li key={l.city_slug}>
              {locale === "ro" ? l.city : l.city_en}
              {l.gym_name ? (
                <>
                  <span className="text-ink-faint"> — </span>
                  {/* a maps search for the gym in its city: a link out, no maps API (lib/gym-map.ts) */}
                  <a
                    href={gymMapHref({ name: l.gym_name, city: l.city })}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={fill(p.openInMaps, { gym: l.gym_name })}
                    data-testid="coach-gym-map"
                    className="inline-flex items-center gap-1 font-semibold text-accent-ink hover:underline"
                  >
                    {l.gym_name}
                    <svg viewBox="0 0 24 24" aria-hidden className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5" />
                    </svg>
                  </a>
                </>
              ) : null}
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

/**
 * "Read the rest — free account": where an anonymous visitor's text was cut on
 * the server (coachTeaser), so the ellipsis leads somewhere — sign up, then
 * back to this page with the whole profile.
 */
function GatedMore({ href }: { href: string }) {
  const { t } = useI18n();
  return (
    <a href={href} data-testid="coach-read-more-gated" className="mt-2 inline-block text-[13.5px] font-semibold text-accent-ink hover:underline">
      {t.coachProfile.publicPage.readMoreGated}
    </a>
  );
}

/**
 * The coach's photo, opened whole on a click: a native modal <dialog> (top
 * layer, focus trapped, Escape and a click outside close it, focus goes back to
 * the photo). The stored avatar is a 256px face crop; the dialog asks the same
 * Cloudinary asset for the full picture. No photo: just the initial, nothing to open.
 */
function ProfilePhoto({ name, url }: { name: string; url: string | null }) {
  const { t } = useI18n();
  const p = t.coachProfile.publicPage;
  const ref = useRef<HTMLDialogElement>(null);
  const size = "h-24 w-24 @2xl:h-32 @2xl:w-32";
  if (!url) return <Avatar name={name} url={null} size={size} />;
  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.showModal()}
        aria-label={p.photoOpen}
        aria-haspopup="dialog"
        data-testid="coach-photo-open"
        className="block cursor-zoom-in rounded-full outline-none ring-accent/60 focus-visible:ring-4"
      >
        <Avatar name={name} url={url} size={size} />
      </button>
      <dialog
        ref={ref}
        aria-label={name}
        onClick={(e) => { if (e.target === e.currentTarget) ref.current?.close(); }}
        className="m-auto max-h-[90vh] max-w-[min(92vw,900px)] overflow-visible bg-transparent p-0 backdrop:bg-black/80"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={fullSizeAvatarUrl(url)} alt={name} className="max-h-[80vh] w-auto max-w-full rounded-3xl object-contain shadow-2xl" />
        <form method="dialog" className="mt-3 flex justify-center">
          <button className="inline-flex h-10 items-center rounded-full bg-surface px-5 text-[13.5px] font-semibold text-ink hover:bg-bg">
            {p.photoClose}
          </button>
        </form>
      </dialog>
    </>
  );
}

/**
 * A specialization chip that explains itself: hovered (desktop) or tapped /
 * pressed from the keyboard (phone, keyboard), a small card says what it means
 * and links to every coach listed under it. Base UI's Popover: portalled,
 * kept inside the screen, Escape and a click outside close it.
 */
function SpecializationChip({ slug, name, primary }: { slug: string; name: string; primary: boolean }) {
  const { t } = useI18n();
  const p = t.coachProfile.publicPage;
  const info = p.specInfo[slug];
  return (
    <Popover.Root>
      <Popover.Trigger
        openOnHover
        delay={150}
        data-testid="coach-specialization"
        className={`inline-flex cursor-help rounded-full px-3.5 py-1.5 text-[13.5px] font-semibold outline-none ring-accent/60 focus-visible:ring-2 ${
          primary ? "bg-accent text-accent-fg" : "bg-surface text-ink hover:bg-accent-soft/60"
        }`}
      >
        {name}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={8} collisionPadding={16} className="z-50">
          <Popover.Popup className="w-[min(18rem,calc(100vw-2rem))] rounded-2xl border border-line bg-surface p-4 text-left shadow-2xl outline-none">
            <Popover.Title className="font-display text-[15px] font-bold tracking-tight text-ink">{name}</Popover.Title>
            {info ? <Popover.Description className="mt-1 text-[13px] leading-relaxed text-ink-soft">{info}</Popover.Description> : null}
            <a href={`/coaches/specialization/${slug}`} className="mt-3 inline-block text-[13px] font-semibold text-accent-ink hover:underline">
              {fill(p.specMore, { name })}
            </a>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
