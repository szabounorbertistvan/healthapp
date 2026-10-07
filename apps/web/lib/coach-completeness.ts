/**
 * Profile completeness for the coach's marketplace (20261108100000). Not a
 * count of filled columns: each item is something a person deciding whether
 * to train with this coach looks for, weighted by how much it matters, and
 * the six required ones are exactly what publishing needs
 * (coach_profile_missing(), mirrored by missingFor()) — so 100 % is not
 * reachable by typing one character everywhere (a bio scores in full only
 * from 150 characters; hours count only with a bookable service).
 *
 *   photo 10 · title 10 · bio 15 (5 under 150 chars) · specializations 10
 *   experience 5 · where you coach 10 · languages 5 · services 15
 *   bookable service + weekly hours 10 · a certification 5 · Voinic Verified 5
 *
 * Pure; tested in lib/coach-completeness.test.ts.
 */
import type { CoachProfileMissing, CoachProfileStatus, MyCoachProfile } from "./coach-profile";

export type CompletenessKey =
  | "photo" | "title" | "bio" | "specializations" | "experience" | "location" | "languages"
  | "services" | "availability" | "credentials" | "verified";

export type CompletenessItem = {
  key: CompletenessKey;
  weight: number;
  /** Points earned (a short bio earns part of its weight). */
  earned: number;
  done: boolean;
  /** Publishing needs it. */
  required: boolean;
  /** Where to fix it. */
  href: string;
};

export const BIO_FULL_CHARS = 150;
const STEP = (n: number) => `/settings/coach-profile?step=${n}`;

export function profileCompleteness(
  mine: Pick<MyCoachProfile, "profile" | "specializations" | "languages" | "locations" | "services" | "certifications">,
  extras: { hasAvatar: boolean; availabilityBlocks: number; bookableServices: number },
): { pct: number; items: CompletenessItem[]; next: CompletenessItem[] } {
  const p = mine.profile;
  const about = p.about?.trim() ?? "";
  const activeServices = mine.services.filter((s) => s.active);
  const located = (p.online || p.in_person) && (!p.in_person || mine.locations.length > 0);
  const items: CompletenessItem[] = [];
  const add = (key: CompletenessKey, weight: number, done: boolean, required: boolean, href: string, earned = done ? weight : 0) =>
    items.push({ key, weight, done, required, href, earned });

  add("photo", 10, extras.hasAvatar, true, STEP(6));
  add("title", 10, Boolean(p.headline?.trim()), true, STEP(1));
  add("bio", 15, about.length >= BIO_FULL_CHARS, true, STEP(1), about.length >= BIO_FULL_CHARS ? 15 : about.length > 0 ? 5 : 0);
  add("specializations", 10, mine.specializations.length > 0, true, STEP(2));
  add("experience", 5, p.coaching_since !== null, false, STEP(2));
  add("location", 10, located, true, STEP(3));
  add("languages", 5, mine.languages.length > 0, false, STEP(3));
  add("services", 15, activeServices.length > 0, true, STEP(5));
  add("availability", 10, extras.bookableServices > 0 && extras.availabilityBlocks > 0, false, "/bookings/availability");
  add("credentials", 5, mine.certifications.length > 0, false, STEP(4));
  add("verified", 5, p.verification_status === "verified", false, "/settings/coach-profile#verification");

  const pct = Math.min(100, items.reduce((n, i) => n + i.earned, 0));
  // what to do next: required first, then the biggest gain
  const next = items.filter((i) => !i.done)
    .sort((a, b) => Number(b.required) - Number(a.required) || (b.weight - b.earned) - (a.weight - a.earned));
  return { pct, items, next };
}

/**
 * Where the profile stands, in the marketplace's words. "ready" is a draft
 * with nothing missing — the database would accept the submission; it is
 * public only once an admin approves it (pre-moderation, 2026-10-01).
 */
export type MarketplaceState = "draft" | "ready" | CoachProfileStatus;

export function marketplaceState(status: CoachProfileStatus, missing: readonly CoachProfileMissing[]): MarketplaceState {
  if (status === "draft") return missing.length === 0 ? "ready" : "draft";
  return status;
}
