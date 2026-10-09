/**
 * Google Analytics, consent-gated and kept to the public pages.
 *
 * Voinic holds health data, so analytics never runs inside an account: only
 * on the marketing and directory pages a signed-out visitor sees. And it is
 * never loaded before the visitor says yes — GA sets cookies, which under
 * ePrivacy need prior consent (the banner, components/cookie-banner.tsx).
 * Advertising signals are always denied.
 *
 * The measurement id is public by design (it is in every page's HTML once
 * loaded), so it lives here rather than in a secret; NEXT_PUBLIC_GA_ID
 * overrides it, and an empty value switches analytics off.
 */
export const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_ID ?? "G-R15D2B46NL";

/** The visitor's choice, in localStorage. Bump the version to ask everyone again. */
export const ANALYTICS_CONSENT_KEY = "bg-analytics-consent-v1";
/** Fired on window when the choice changes, so the banner and the loader stay in step. */
export const ANALYTICS_CONSENT_EVENT = "bg-analytics-consent";

export type AnalyticsConsent = "granted" | "denied";

export function parseConsent(raw: string | null | undefined): AnalyticsConsent | null {
  return raw === "granted" || raw === "denied" ? raw : null;
}

/** Public, signed-out pages. Everything else — the whole app — is never measured. */
const EXACT = new Set(["/", "/coaches", "/login", "/privacy", "/terms", "/get-the-app"]);
/** Under /coaches: the reader's own lists and the signed-in review form stay out. */
const PRIVATE_UNDER_COACHES = new Set(["bookings", "requests", "saved"]);

export function isAnalyticsPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (EXACT.has(path)) return true;
  const parts = path.split("/").filter(Boolean);
  if (parts[0] !== "coaches" || parts.length < 2) return false;
  if (PRIVATE_UNDER_COACHES.has(parts[1]!)) return false;
  if (parts.length === 2) return true; // a coach page, or a city / specialization landing
  // /coaches/city/<x>, /coaches/specialization/<x> aliases, and a coach's booking page
  if (parts.length === 3) return parts[1] === "city" || parts[1] === "specialization" || parts[2] === "book";
  return false;
}

/** The URL GA receives: path and query only for public pages, never a fragment. */
export function analyticsPageLocation(origin: string, pathname: string, search: string): string {
  return `${origin}${pathname}${search}`;
}
