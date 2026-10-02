/**
 * Coach onboarding: the wizard's model, free of React and of the network, so
 * it can be unit-tested (lib/coach-onboarding.test.ts).
 *
 * The database decides what may be submitted (coach_profile_missing() in
 * 20261020100000). `missingFor()` mirrors it so the wizard can tick the
 * checklist as the coach types instead of after a round trip; when the two
 * disagree the server's list wins — submit shows what the RPC returned.
 */
import {
  COACH_LIMITS, isValidCoachSlug, type CoachProfileMissing, type CoachProfileStatus, type PriceUnit,
} from "./coach-profile";

export const STEPS = ["identity", "expertise", "where", "certifications", "services", "publish"] as const;
export type StepId = (typeof STEPS)[number];

/** `?step=3` (1-based, as the progress reads) → index; anything else → the first step. */
export function parseStep(param: string | string[] | undefined | null): number {
  const raw = Array.isArray(param) ? param[0] : param;
  const n = Number(raw);
  if (!Number.isInteger(n)) return 0;
  return Math.min(Math.max(n, 1), STEPS.length) - 1;
}

export function nextStep(index: number): number {
  return Math.min(index + 1, STEPS.length - 1);
}
export function previousStep(index: number): number {
  return Math.max(index - 1, 0);
}

/** What the wizard holds while the coach edits: the draft as the editor sees it. */
export type DraftState = {
  slug: string;
  headline: string;
  about: string;
  coachingSince: number | null;
  online: boolean;
  inPerson: boolean;
  specializations: string[];
  primarySpecialization: string | null;
  languages: string[];
  locations: { city: string; gymName: string }[];
  /** Only what the checklist needs from a service. */
  services: { active: boolean; priceUnit: PriceUnit; priceCents: number | null }[];
  hasAvatar: boolean;
};

/** Mirror of coach_profile_missing(), same codes, same order. */
export function missingFor(d: DraftState, currentYear = new Date().getFullYear()): CoachProfileMissing[] {
  const missing: CoachProfileMissing[] = [];
  if (!d.headline.trim()) missing.push("HEADLINE");
  if (!d.about.trim()) missing.push("ABOUT");
  if (d.specializations.length === 0) missing.push("SPECIALIZATION");
  if (!d.online && !d.inPerson) missing.push("DELIVERY_MODE");
  if (d.inPerson && d.locations.length === 0) missing.push("LOCATION");
  const active = d.services.filter((s) => s.active);
  if (active.length === 0) missing.push("SERVICE");
  if (active.some((s) => s.priceUnit !== "custom" && s.priceCents === null)) missing.push("SERVICE_PRICE");
  if (!d.hasAvatar) missing.push("AVATAR");
  if (!isValidCoachSlug(d.slug)) missing.push("SLUG");
  if (d.coachingSince !== null && d.coachingSince > currentYear) missing.push("COACHING_SINCE");
  return missing;
}

/** The step that fixes a missing item — the checklist's "Fix" link. */
export function stepForMissing(code: CoachProfileMissing): number {
  switch (code) {
    case "HEADLINE": case "ABOUT": case "SLUG": return 0;
    case "SPECIALIZATION": case "COACHING_SINCE": return 1;
    case "DELIVERY_MODE": case "LOCATION": return 2;
    case "SERVICE": case "SERVICE_PRICE": return 4;
    case "AVATAR": return 5;
  }
}

/** The five lines of the "ready to submit" summary, each ticked or not. */
export const SUMMARY_GROUPS = ["professional", "specializations", "location", "services", "photo"] as const;
export type SummaryGroup = (typeof SUMMARY_GROUPS)[number];

const GROUP_OF: Record<CoachProfileMissing, SummaryGroup> = {
  HEADLINE: "professional", ABOUT: "professional", SLUG: "professional", COACHING_SINCE: "specializations",
  SPECIALIZATION: "specializations", DELIVERY_MODE: "location", LOCATION: "location",
  SERVICE: "services", SERVICE_PRICE: "services", AVATAR: "photo",
};

export function summary(missing: readonly CoachProfileMissing[]): { group: SummaryGroup; done: boolean }[] {
  const open = new Set(missing.map((m) => GROUP_OF[m]));
  return SUMMARY_GROUPS.map((group) => ({ group, done: !open.has(group) }));
}

/** Which steps already have something in them — the filled dots of the progress bar. */
export function stepsTouched(d: DraftState, certifications: number): boolean[] {
  return [
    Boolean(d.headline.trim() || d.about.trim()),
    d.specializations.length > 0 || d.coachingSince !== null,
    d.online || d.inPerson || d.languages.length > 0,
    certifications > 0,
    d.services.length > 0,
    d.hasAvatar,
  ];
}

// ---------- field checks for instant feedback (the database re-checks all of them) ----------

export type IdentityErrors = { headline?: "TOO_LONG"; about?: "TOO_LONG"; slug?: "FORMAT" };

export function identityErrors(d: Pick<DraftState, "headline" | "about" | "slug">): IdentityErrors {
  const e: IdentityErrors = {};
  if (d.headline.trim().length > COACH_LIMITS.headline) e.headline = "TOO_LONG";
  if (d.about.trim().length > COACH_LIMITS.about) e.about = "TOO_LONG";
  if (!isValidCoachSlug(d.slug)) e.slug = "FORMAT";
  return e;
}

/** A slug as someone types it: lower case, anything else one dash. Leading/trailing dashes kept while typing. */
export function slugify(input: string): string {
  return input.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").slice(0, COACH_LIMITS.slugMax);
}

export function coachingSinceError(year: number | null, currentYear = new Date().getFullYear()): "RANGE" | null {
  if (year === null) return null;
  return Number.isInteger(year) && year >= 1950 && year <= currentYear ? null : "RANGE";
}

/** Toggle one specialization, refusing a ninth. The primary follows: dropped with its chip, else the first. */
export function toggleSpecialization(
  selected: readonly string[], primary: string | null, slug: string, max: number = COACH_LIMITS.specializations,
): { selected: string[]; primary: string | null; refused: boolean } {
  if (selected.includes(slug)) {
    const next = selected.filter((s) => s !== slug);
    return { selected: next, primary: primary === slug ? (next[0] ?? null) : primary, refused: false };
  }
  if (selected.length >= max) return { selected: [...selected], primary, refused: true };
  const next = [...selected, slug];
  return { selected: next, primary: primary ?? slug, refused: false };
}

// ---------- prices ----------

/**
 * "99", "99.5", "99,50" → minor units. Empty → null (on request). Anything
 * else → undefined, which the form shows as an error.
 */
export function priceToCents(input: string): number | null | undefined {
  const s = input.trim().replace(/\s/g, "").replace(",", ".");
  if (s === "") return null;
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(s)) return undefined;
  return Math.round(Number(s) * 100);
}

export function centsToPrice(cents: number | null): string {
  if (cents === null) return "";
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

/** "99 €" / "99,50 lei" in the reader's locale; null when there is no price to show. */
export function formatPrice(cents: number | null, currency: string | null, locale: "en" | "ro"): string | null {
  if (cents === null || !currency) return null;
  const whole = cents % 100 === 0;
  return new Intl.NumberFormat(locale === "ro" ? "ro-RO" : "en-GB", {
    style: "currency", currency, minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2,
  }).format(cents / 100);
}

/** Currencies offered in the service form. RON first: the market is Romania. */
export const CURRENCIES = ["RON", "EUR", "USD", "GBP", "MDL"] as const;

export type ServiceDraft = {
  name: string;
  description: string;
  price: string;
  priceUnit: PriceUnit;
};
export type ServiceErrors = { name?: "REQUIRED" | "TOO_LONG"; description?: "TOO_LONG"; price?: "FORMAT" | "REQUIRED" };

export function serviceErrors(s: ServiceDraft): ServiceErrors {
  const e: ServiceErrors = {};
  if (!s.name.trim()) e.name = "REQUIRED";
  else if (s.name.trim().length > COACH_LIMITS.serviceName) e.name = "TOO_LONG";
  if (s.description.trim().length > COACH_LIMITS.serviceDescription) e.description = "TOO_LONG";
  const cents = priceToCents(s.price);
  if (cents === undefined) e.price = "FORMAT";
  else if (cents === null && s.priceUnit !== "custom") e.price = "REQUIRED";
  return e;
}

/** Move one item up (-1) or down (+1); out of range is a no-op. */
export function moveItem<T>(list: readonly T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) return [...list];
  const next = [...list];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

// ---------- status ----------

export type StatusView = {
  status: CoachProfileStatus;
  /** Can the six steps be edited right now? Only a draft. */
  editable: boolean;
  /** The one action the status card offers. */
  action: "continue" | "edit" | "view" | null;
  tone: "neutral" | "warn" | "accent" | "risk";
};

export function statusView(status: CoachProfileStatus): StatusView {
  switch (status) {
    case "draft": return { status, editable: true, action: "continue", tone: "neutral" };
    case "pending_review": return { status, editable: false, action: "edit", tone: "warn" };
    case "published": return { status, editable: false, action: "view", tone: "accent" };
    case "suspended": return { status, editable: false, action: null, tone: "risk" };
  }
}
