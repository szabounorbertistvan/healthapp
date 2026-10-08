/**
 * The coach's own-words profile content (20261111100000): approach,
 * experience, the goals they suit, and where else to find them. Pure —
 * tested in lib/coach-content.test.ts. The database is the authority
 * (coach_social_links_valid(), the client_goals check); this mirrors it so
 * the editor can say what is wrong before a save is refused.
 */

export const CLIENT_GOALS = [
  "fat_loss", "muscle_gain", "strength", "endurance", "general_fitness", "sport_performance", "mobility",
  "healthy_habits", "beginners", "return_to_training",
] as const;
export type ClientGoal = (typeof CLIENT_GOALS)[number];
export const MAX_CLIENT_GOALS = 6;
export const CONTENT_LIMITS = { approach: 1500, experienceSummary: 1500 } as const;

export const SOCIAL_NETWORKS = ["instagram", "tiktok", "youtube", "facebook", "linkedin", "website"] as const;
export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number];
export type SocialLinks = Partial<Record<SocialNetwork, string>>;

/** Same patterns as coach_social_links_valid() in SQL. */
const HANDLE: Record<Exclude<SocialNetwork, "website">, RegExp> = {
  instagram: /^[A-Za-z0-9._]{1,30}$/,
  tiktok: /^[A-Za-z0-9._]{2,24}$/,
  youtube: /^@?[A-Za-z0-9._-]{3,100}$/,
  facebook: /^[A-Za-z0-9.]{5,50}$/,
  linkedin: /^[A-Za-z0-9-]{3,100}$/,
};
const WEBSITE = /^https:\/\/[A-Za-z0-9.-]+\.[A-Za-z]{2,}(\/[^\s<>"'`]*)?$/;

export function validSocialValue(network: SocialNetwork, value: string): boolean {
  if (network === "website") return value.length <= 200 && WEBSITE.test(value);
  return HANDLE[network].test(value);
}

/**
 * What a coach typed → what is stored: trimmed, a pasted profile URL or a
 * leading @ reduced to the handle (the database stores handles, never URLs),
 * empty entries dropped. `invalid` names the first entry that still does not
 * pass, so the editor can point at it.
 */
export function cleanSocialLinks(input: Partial<Record<string, string | null | undefined>>): { links: SocialLinks; invalid: SocialNetwork | null } {
  const links: SocialLinks = {};
  let invalid: SocialNetwork | null = null;
  for (const network of SOCIAL_NETWORKS) {
    let v = (input[network] ?? "").trim();
    if (!v) continue;
    if (network !== "website") {
      // "https://www.instagram.com/ana.fit/" → "ana.fit"; "@ana.fit" → "ana.fit" (YouTube keeps its @)
      const m = v.match(/^(?:https?:\/\/)?(?:www\.|m\.)?(?:instagram\.com|tiktok\.com|youtube\.com|facebook\.com|fb\.com|linkedin\.com)\/(?:in\/|c\/)?(@?[^/?#]+)/i);
      if (m) v = m[1]!;
      if (network !== "youtube") v = v.replace(/^@/, "");
      if (network === "tiktok") v = v.replace(/^@/, "");
    }
    if (!validSocialValue(network, v)) {
      invalid ??= network;
      continue;
    }
    links[network] = v;
  }
  return { links, invalid };
}

/** The public link for a stored handle. Built here, never taken from the coach, so it can only point where it says. */
export function socialUrl(network: SocialNetwork, value: string): string | null {
  if (!validSocialValue(network, value)) return null;
  switch (network) {
    case "instagram": return `https://www.instagram.com/${value}/`;
    case "tiktok": return `https://www.tiktok.com/@${value}`;
    case "youtube": return `https://www.youtube.com/${value.startsWith("@") ? value : `@${value}`}`;
    case "facebook": return `https://www.facebook.com/${value}`;
    case "linkedin": return `https://www.linkedin.com/in/${value}`;
    case "website": return value;
  }
}

/** The stored links as [network, url] pairs in a fixed order, invalid ones dropped. */
export function socialEntries(links: SocialLinks | null | undefined): { network: SocialNetwork; url: string; label: string }[] {
  if (!links) return [];
  return SOCIAL_NETWORKS.flatMap((network) => {
    const v = links[network];
    const url = v ? socialUrl(network, v) : null;
    if (!v || !url) return [];
    const label = network === "website" ? url.replace(/^https:\/\//, "").replace(/\/$/, "") : v.replace(/^@/, "");
    return [{ network, url, label }];
  });
}

/** Unique, known goal codes, in catalog order, capped — what the database accepts. */
export function cleanClientGoals(goals: readonly string[]): ClientGoal[] {
  const set = new Set(goals);
  return CLIENT_GOALS.filter((g) => set.has(g)).slice(0, MAX_CLIENT_GOALS);
}

/**
 * Does the text promise what nobody can promise? Guaranteed results, a set
 * amount of weight in a set time, curing or treating a condition. A nudge in
 * the editor (and a flag an admin reviewing the profile can see), not a
 * filter: pre-moderation decides. English and Romanian, diacritics or not.
 */
const CLAIMS: RegExp[] = [
  /\bguarantee(d|s)?\b/i,
  /\bgarantat[aăe]?\b|\bgarant(ez|am|ăm)\b|\bgaran[tț]ie\b/i,
  /\b(lose|drop|pierz[ia]|sl[aă]be[sș]ti|scapi de)\s+\d+\s*(kg|kilo|lbs?|pounds|kilograme)\b.{0,30}\b(in|în|days?|weeks?|zile|s[aă]pt[aă]m[aâ]ni|luni|months?)\b/i,
  /\b\d+\s*(kg|kilo|lbs?|kilograme)\s+(in|în)\s+\d+\s*(days?|weeks?|zile|s[aă]pt[aă]m[aâ]ni)\b/i,
  /\b(cure|cures|cured|heal|heals|treat(s|ment)? (of |for )?(diabetes|depression|disease|illness|injur))/i,
  /\bvindec(a|ă|are|ăm)\b|\btrateaz[aă]\b|\btratament (pentru|medical)\b/i,
  /\b100\s?%\s*(results|rezultate|success|succes)\b/i,
];
export function hasRiskyClaim(text: string | null | undefined): boolean {
  const t = (text ?? "").normalize("NFC");
  return t.trim().length > 0 && CLAIMS.some((re) => re.test(t));
}
