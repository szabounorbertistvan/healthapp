/**
 * The public coach page (/coaches/[slug]): what the Start coaching button
 * says, and what search engines read. Pure, so it is unit-tested
 * (lib/coach-public.test.ts) and shared by the page, its metadata and the
 * onboarding preview.
 */
import type { CoachPublicProfile, CoachViewerState } from "./coach-profile";

/**
 * The one state the Start coaching control is in for this reader. The
 * database re-checks every one of these (request_coaching) — this only picks
 * what to draw.
 */
export type StartCoachingState =
  | "preview"        // the onboarding preview: drawn, never live
  | "sign_in"        // anonymous: the button leads to sign-in
  | "self"           // the coach's own page
  | "client"         // already this coach's client
  | "pending"        // a request is waiting for the coach
  | "accepted"       // the coach accepted: Message coach (no relationship yet, 20261104100000)
  | "contact_again"  // the last request was declined, cancelled or closed: a new one is welcome
  | "not_accepting"  // the coach is full
  | "available";

export function startCoachingState(
  profile: Pick<CoachPublicProfile, "accepting_clients">,
  viewer: CoachViewerState | null,
  opts: { preview?: boolean; signedIn: boolean },
): StartCoachingState {
  if (opts.preview) return "preview";
  if (viewer?.is_self) return "self";
  if (viewer?.is_client) return "client";
  if (viewer?.pending_request) return "pending";
  // An accepted conversation stays open when the coach later stops taking clients.
  const last = viewer?.last_request;
  if (last?.status === "accepted" && !last.started) return "accepted";
  if (!profile.accepting_clients) return "not_accepting";
  if (!opts.signedIn) return "sign_in";
  if (last && ["declined", "cancelled", "closed"].includes(last.status)) return "contact_again";
  return "available";
}

/** Whole years since coaching_since, or null when unknown or not yet a year. */
export function yearsOfExperience(coachingSince: number | null, now = new Date()): number | null {
  if (!coachingSince) return null;
  const years = now.getFullYear() - coachingSince;
  return years > 0 ? years : null;
}

// ---------- search engines ----------

type Locale = "en" | "ro";

const IN: Record<Locale, string> = { en: "in", ro: "în" };
const COACH: Record<Locale, string> = { en: "Personal trainer", ro: "Antrenor personal" };
const ONLINE: Record<Locale, string> = { en: "Online coaching", ro: "Coaching online" };

/** The city people search with: the first location, in the reader's language. */
function primaryCity(p: CoachPublicProfile, locale: Locale): string | null {
  const l = p.locations[0];
  if (!l) return null;
  return locale === "ro" ? l.city : l.city_en;
}

/**
 * "Andrei Popescu — Personal Trainer în Cluj-Napoca | Voinic". The headline
 * when the coach wrote one, a generic role otherwise; the city when they
 * coach in person, "Online coaching" when they only coach online.
 */
export function coachPageTitle(p: CoachPublicProfile, locale: Locale, appName: string): string {
  const role = p.headline?.trim() || COACH[locale];
  const city = p.in_person ? primaryCity(p, locale) : null;
  const where = city ? ` ${IN[locale]} ${city}` : !p.in_person && p.online ? ` · ${ONLINE[locale]}` : "";
  return `${p.display_name} — ${role}${where} | ${appName}`;
}

/** One or two plain sentences from public fields only, under 160 characters. */
export function coachPageDescription(p: CoachPublicProfile, locale: Locale): string {
  const specs = p.specializations.slice(0, 3).map((s) => (locale === "ro" ? s.name_ro : s.name_en));
  const modes = [p.online ? (locale === "ro" ? "online" : "online") : null, p.in_person ? (locale === "ro" ? "față în față" : "in person") : null]
    .filter(Boolean).join(locale === "ro" ? " și " : " and ");
  const city = p.in_person ? primaryCity(p, locale) : null;
  const lead = locale === "ro"
    ? `${p.display_name}${p.headline ? `, ${p.headline}` : ""}${specs.length ? ` — ${specs.join(", ")}` : ""}.`
    : `${p.display_name}${p.headline ? `, ${p.headline}` : ""}${specs.length ? ` — ${specs.join(", ")}` : ""}.`;
  const how = modes
    ? locale === "ro"
      ? ` Coaching ${modes}${city ? ` în ${city}` : ""} pe Voinic.`
      : ` Coaching ${modes}${city ? ` in ${city}` : ""} on Voinic.`
    : "";
  const about = p.about?.replace(/\s+/g, " ").trim() ?? "";
  const text = `${lead}${how}${about ? ` ${about}` : ""}`;
  return text.length <= 160 ? text : `${text.slice(0, 157).replace(/\s+\S*$/, "")}…`;
}

/**
 * schema.org for a professional profile: a ProfilePage whose subject is the
 * coach (Person), with what they offer as Offers. Prices only where the
 * coach made them public, as the page shows.
 */
export function coachJsonLd(p: CoachPublicProfile, url: string, locale: Locale): Record<string, unknown> {
  const person: Record<string, unknown> = {
    "@type": "Person",
    name: p.display_name,
    url,
    jobTitle: p.headline ?? COACH[locale],
    ...(p.avatar_url ? { image: p.avatar_url } : {}),
    ...(p.about ? { description: p.about.slice(0, 500) } : {}),
    ...(p.specializations.length ? { knowsAbout: p.specializations.map((s) => (locale === "ro" ? s.name_ro : s.name_en)) } : {}),
    ...(p.languages.length ? { knowsLanguage: p.languages.map((l) => l.code) } : {}),
    ...(p.locations.length
      ? { workLocation: p.locations.map((l) => ({ "@type": "Place", name: l.gym_name ?? (locale === "ro" ? l.city : l.city_en),
          address: { "@type": "PostalAddress", addressLocality: locale === "ro" ? l.city : l.city_en, addressCountry: l.country_code } })) }
      : {}),
    ...(p.certifications.length
      ? { hasCredential: p.certifications.map((c) => ({ "@type": "EducationalOccupationalCredential", name: c.name,
          ...(c.issuer ? { recognizedBy: { "@type": "Organization", name: c.issuer } } : {}) })) }
      : {}),
    ...(p.services.length
      ? { makesOffer: p.services.map((s) => ({ "@type": "Offer", name: s.name, ...(s.description ? { description: s.description } : {}),
          ...(s.price_public && s.price_cents !== null && s.currency ? { price: (s.price_cents / 100).toFixed(2), priceCurrency: s.currency } : {}) })) }
      : {}),
  };
  return { "@context": "https://schema.org", "@type": "ProfilePage", url, mainEntity: person };
}

// ---------- the page ----------

/** How the coach works: both formats is "hybrid", the one word the page and the filters use. */
export function coachFormat(p: Pick<CoachPublicProfile, "online" | "in_person">): "hybrid" | "online" | "in_person" | null {
  if (p.online && p.in_person) return "hybrid";
  if (p.online) return "online";
  if (p.in_person) return "in_person";
  return null;
}

/**
 * "Why train with …": one line per fact the profile actually has, strongest
 * first. Nothing is estimated and nothing is shown at zero — a coach with an
 * empty profile gets an empty list, and the section draws only its CTA.
 */
export type WhyPoint =
  | { kind: "verified" }
  | { kind: "experience"; years: number }
  | { kind: "since"; year: number }
  | { kind: "focus"; slugs: string[] }
  | { kind: "services"; n: number }
  | { kind: "programs"; n: number }
  | { kind: "posts"; n: number };

export function coachWhyPoints(
  p: Pick<CoachPublicProfile, "verified" | "coaching_since" | "specializations" | "services" | "stats">,
  now = new Date(),
): WhyPoint[] {
  const points: WhyPoint[] = [];
  if (p.verified) points.push({ kind: "verified" });
  const years = yearsOfExperience(p.coaching_since, now);
  if (years) points.push({ kind: "experience", years });
  else if (p.coaching_since) points.push({ kind: "since", year: p.coaching_since });
  if (p.specializations.length > 0) points.push({ kind: "focus", slugs: p.specializations.slice(0, 3).map((s) => s.slug) });
  if (p.services.length > 0) points.push({ kind: "services", n: p.services.length });
  if (p.stats?.programs) points.push({ kind: "programs", n: p.stats.programs });
  if (p.stats?.posts) points.push({ kind: "posts", n: p.stats.posts });
  return points;
}

// ---------- the public directory's foundation (20261107100000) ----------

/**
 * May search engines index this page? What publishing required, still there:
 * a headline, an about, an avatar, a specialization and a service. An avatar
 * can be removed after approval — a page that lost its essentials says
 * noindex and leaves the sitemap (coach_sitemap() holds the same rule).
 */
export function coachIndexable(
  p: Pick<CoachPublicProfile, "headline" | "about" | "avatar_url" | "specializations" | "services">,
): boolean {
  return Boolean(p.headline?.trim() && p.about?.trim() && p.avatar_url?.trim()
    && p.specializations.length > 0 && p.services.length > 0);
}

export const TEASER_ABOUT_CHARS = 280;
export const TEASER_SERVICES = 3;
export const TEASER_REVIEWS = 3;
export const TEASER_PROGRAMS = 3;

/**
 * What an anonymous visitor's page is built from: enough to know who the
 * coach is (everything in the header, the specializations, the facts), the
 * start of the about, the first services. Cut on the server, so the page's
 * payload carries no more than it shows. Not a security boundary — all of it
 * is public through coach_public_profile() — a conversion one.
 */
export function coachTeaser(p: CoachPublicProfile): { profile: CoachPublicProfile; aboutCut: boolean; moreServices: number } {
  const about = p.about?.trim() ?? null;
  let cut = about;
  if (about && about.length > TEASER_ABOUT_CHARS) {
    cut = `${about.slice(0, TEASER_ABOUT_CHARS).replace(/\s+\S*$/, "").trimEnd()}…`;
  }
  return {
    profile: { ...p, about: cut, services: p.services.slice(0, TEASER_SERVICES) },
    aboutCut: cut !== about,
    moreServices: Math.max(0, p.services.length - TEASER_SERVICES),
  };
}

/** Where "See the full profile" / "Create a free account" go: sign-in or sign-up, and back to this exact page. */
export function coachGateHref(slug: string, mode: "signin" | "signup"): string {
  const params = new URLSearchParams({ next: `/coaches/${slug}` });
  if (mode === "signup") params.set("mode", "signup");
  return `/login?${params}`;
}

/**
 * The page's JSON-LD: the ProfilePage (coachJsonLd) and its breadcrumb, as
 * one @graph. No aggregateRating: Google's review snippets do not support a
 * Person as the thing reviewed, and calling an online coach a LocalBusiness
 * would be untrue — the rating is shown on the page, not marked up.
 */
export function coachPageJsonLd(p: CoachPublicProfile, siteUrl: string, locale: Locale, labels: { home: string; coaches: string }) {
  const url = `${siteUrl}/coaches/${p.slug}`;
  const page = coachJsonLd(p, url, locale);
  const person = page.mainEntity as Record<string, unknown>;
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        ...page,
        "@context": undefined,
        ...(p.published_at ? { dateCreated: p.published_at } : {}),
        mainEntity: {
          ...person,
          ...(p.username ? { alternateName: `@${p.username}` } : {}),
          interactionStatistic: { "@type": "InteractionCounter", interactionType: "https://schema.org/FollowAction", userInteractionCount: p.followers },
        },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: labels.home, item: siteUrl },
          { "@type": "ListItem", position: 2, name: labels.coaches, item: `${siteUrl}/coaches` },
          { "@type": "ListItem", position: 3, name: p.display_name, item: url },
        ],
      },
    ],
  };
}
