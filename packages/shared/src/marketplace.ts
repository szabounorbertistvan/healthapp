/**
 * Marketplace measurement and ranking — the rules both sides share.
 *
 * Attribution (20261110120000): where a visit came from, from the URL's
 * utm_* parameters first, then the referrer's host. The database stores the
 * same cleaned tokens (marketplace_clean: lower case, [a-z0-9_.-], capped)
 * and re-cleans whatever it is sent; this is the first answer, not the only.
 * Nothing here reads or writes the visitor's device.
 *
 * Ranking (20261110130000): coach_ranked() computes the score in SQL. The
 * weights and the two statistical pieces are mirrored here so the admin
 * inspector can label them and the rules are unit-tested; a change to one
 * side without the other is a bug (the pgTAP suite pins the same numbers).
 */

export type Attribution = { source: string | null; medium: string | null; campaign: string | null };

/** marketplace_clean(): lower case, only [a-z0-9_.-], capped; blank is null. */
export function cleanToken(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, "").slice(0, max);
  return t.length > 0 ? t : null;
}

/** Referrer hosts we name; anything else external is "referral". */
const REFERRERS: [RegExp, string][] = [
  [/(^|\.)google\./, "google"],
  [/(^|\.)bing\.com$/, "bing"],
  [/(^|\.)duckduckgo\.com$/, "duckduckgo"],
  [/(^|\.)instagram\.com$/, "instagram"],
  [/(^|\.)(l\.)?facebook\.com$|(^|\.)fb\.com$|(^|\.)m\.facebook\.com$/, "facebook"],
  [/(^|\.)tiktok\.com$/, "tiktok"],
  [/(^|\.)youtube\.com$|(^|\.)youtu\.be$/, "youtube"],
  [/(^|\.)linkedin\.com$|(^|\.)lnkd\.in$/, "linkedin"],
  [/(^|\.)(twitter|x)\.com$|(^|\.)t\.co$/, "x"],
  [/(^|\.)reddit\.com$/, "reddit"],
  [/(^|\.)whatsapp\.com$|(^|\.)wa\.me$/, "whatsapp"],
];

/** Short aliases people type into utm_source. */
const SOURCE_ALIASES: Record<string, string> = { ig: "instagram", fb: "facebook", tt: "tiktok", yt: "youtube", twitter: "x" };

/**
 * Where a visit came from. utm_source wins (aliases folded); otherwise the
 * referrer: a known host by name, our own site as "internal" (moving around
 * the app is not acquisition), any other host as "referral", and no referrer
 * at all as null — read as "direct" on every screen.
 */
export function classifyAttribution(input: {
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  referrer?: string | null;
  siteHost?: string | null;
}): Attribution {
  const medium = cleanToken(input.utmMedium, 40);
  const campaign = cleanToken(input.utmCampaign, 80);
  const utm = cleanToken(input.utmSource, 40);
  if (utm) return { source: SOURCE_ALIASES[utm] ?? utm, medium, campaign };

  let host: string | null = null;
  try {
    host = input.referrer ? new URL(input.referrer).hostname.toLowerCase() : null;
  } catch {
    host = null;
  }
  if (!host) return { source: null, medium, campaign };
  const site = (input.siteHost ?? "").toLowerCase().replace(/^www\./, "");
  if (site && (host === site || host.endsWith(`.${site}`))) return { source: "internal", medium, campaign };
  for (const [re, name] of REFERRERS) if (re.test(host)) return { source: name, medium: medium ?? "referral", campaign };
  return { source: "referral", medium, campaign };
}

/** The events a browser may send (marketplace_track's closed list). */
export const CLIENT_MARKETPLACE_EVENTS = [
  "directory_view", "profile_view", "cta_contact", "cta_book", "cta_save", "cta_full_profile", "signup_started",
] as const;
export type ClientMarketplaceEvent = (typeof CLIENT_MARKETPLACE_EVENTS)[number];

/**
 * The sign-up reference the form sends as user metadata (read by the
 * on_auth_user_created_marketplace trigger): the coach page the person came
 * from — taken from the `next` path, never a free field — and the source.
 * Null when there is nothing to attribute.
 */
export function signupReference(next: string | null | undefined, attribution: Partial<Attribution>):
  { coach: string | null; source: string | null; medium: string | null; campaign: string | null } | null {
  const m = typeof next === "string" ? /^\/coaches\/([a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?)(?:[/?#]|$)/.exec(next) : null;
  const reserved = new Set(["requests", "saved", "bookings"]);
  const slug = m?.[1] ?? null;
  const coach = slug && !reserved.has(slug) ? slug : null;
  const source = cleanToken(attribution.source, 40);
  if (!coach && !source) return null;
  return { coach, source, medium: cleanToken(attribution.medium, 40), campaign: cleanToken(attribution.campaign, 80) };
}

// ---------- ranking (mirrors coach_ranked) ----------

export const RANK_WEIGHTS = { trust: 0.3, quality: 0.3, responsiveness: 0.15, activity: 0.15, engagement: 0.1 } as const;
/** With a query or a specialization filter, relevance carries this share of the score. */
export const RANK_RELEVANCE_SHARE = 0.5;
export const RATING_PRIOR = { mean: 3.5, weight: 5 } as const;
export const COLD_START = { max: 0.06, days: 45 } as const;

/** The Bayesian rating: the average pulled towards a neutral 3.5 by five virtual reviews. */
export function bayesianRating(count: number, average: number | null): number {
  const n = Math.max(0, count);
  return (RATING_PRIOR.weight * RATING_PRIOR.mean + n * (average ?? 0)) / (RATING_PRIOR.weight + n);
}

/** quality = 0.7·rating (1–5 → 0–1) + 0.3·outcomes. */
export function rankQuality(count: number, average: number | null, completedBookings: number, completedCoachings: number): number {
  const rating = (bayesianRating(count, average) - 1) / 4;
  const outcomes = 1 - Math.exp(-(completedBookings + 2 * completedCoachings) / 8);
  return 0.7 * rating + 0.3 * outcomes;
}

/** A small boost for a new, qualified coach, fading to nothing over 45 days. */
export function coldStartBoost(daysSincePublished: number, qualified: boolean): number {
  if (!qualified || daysSincePublished >= COLD_START.days || daysSincePublished < 0) return 0;
  return COLD_START.max * (1 - daysSincePublished / COLD_START.days);
}

export type RankParts = {
  relevance: number | null; trust: number; quality: number; responsiveness: number; activity: number;
  engagement: number; cold_start: number; placement: number;
};

/** The score coach_ranked orders by. Placement is always 0 (no paid ranking). */
export function rankScore(p: RankParts): number {
  const base = RANK_WEIGHTS.trust * p.trust + RANK_WEIGHTS.quality * p.quality
    + RANK_WEIGHTS.responsiveness * p.responsiveness + RANK_WEIGHTS.activity * p.activity
    + RANK_WEIGHTS.engagement * p.engagement;
  const organic = p.relevance === null ? base : RANK_RELEVANCE_SHARE * p.relevance + (1 - RANK_RELEVANCE_SHARE) * base;
  return organic + p.cold_start + p.placement;
}
