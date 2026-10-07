/**
 * Coach Discovery: the shapes of the coach profile and the codes its RPCs
 * raise. Pure — no server or client runtime — so screens on either side and
 * the actions can share it.
 *
 * The database (20261020100000_coach_discovery_foundation.sql) is the source
 * of truth for every rule here; these are mirrors for typing and for checking
 * an action's arguments before a round trip. There is no generated
 * `Database` type in this repo, so the row shapes are written out by hand.
 */

/** hidden (20261029100000): published, then switched off by the coach; back without a review. */
export const COACH_PROFILE_STATUSES = ["draft", "pending_review", "published", "hidden", "suspended"] as const;
export type CoachProfileStatus = (typeof COACH_PROFILE_STATUSES)[number];

export const SERVICE_KINDS = [
  "online_coaching", "personal_training", "nutrition_coaching", "training_nutrition", "training_program",
  "group_coaching", "consultation", "other",
] as const;
export type ServiceKind = (typeof SERVICE_KINDS)[number];

/**
 * What a price is per (20261031100000). The pricing model is derived from it
 * (lib/coach-onboarding.ts pricingOf): free · one-time (session, package) ·
 * recurring (week, month, year — the unit is the billing period) · on request
 * (custom). Nothing is charged: Voinic has no payments yet.
 */
export const PRICE_UNITS = ["session", "package", "week", "month", "year", "free", "custom"] as const;
export type PriceUnit = (typeof PRICE_UNITS)[number];

/** How a service reaches the client. digital = a plan or program, no live sessions. */
export const SERVICE_DELIVERY = ["online", "in_person", "hybrid", "digital"] as const;
export type ServiceDelivery = (typeof SERVICE_DELIVERY)[number];

export const DURATION_UNITS = ["minutes", "days", "weeks", "months"] as const;
export type DurationUnit = (typeof DURATION_UNITS)[number];

export const VERIFICATION_KINDS = ["identity", "certification", "business"] as const;
export type VerificationKind = (typeof VERIFICATION_KINDS)[number];
/** What the public sees: one badge per verified kind. */
export type VerificationBadge = `${VerificationKind}_verified`;

export const COACHING_REQUEST_STATUSES = ["pending", "accepted", "declined", "cancelled", "closed"] as const;
export type CoachingRequestStatus = (typeof COACHING_REQUEST_STATUSES)[number];

/** Limits the database enforces, mirrored so the editor can say so first. */
export const COACH_LIMITS = {
  slugMin: 3,
  slugMax: 60,
  headline: 120,
  about: 3000,
  specializations: 8,
  languages: 10,
  locations: 5,
  gymName: 120,
  serviceName: 100,
  serviceDescription: 1000,
  certificationName: 120,
  certificationIssuer: 120,
  requestMessage: 2000,
} as const;

export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function isValidCoachSlug(slug: string): boolean {
  return slug.length >= COACH_LIMITS.slugMin && slug.length <= COACH_LIMITS.slugMax && SLUG_PATTERN.test(slug);
}

/** What coach_profile_missing() / submit_coach_for_review() report. */
export type CoachProfileMissing =
  | "HEADLINE" | "ABOUT" | "SPECIALIZATION" | "DELIVERY_MODE" | "LOCATION"
  | "SERVICE" | "SERVICE_PRICE" | "AVATAR" | "SLUG" | "COACHING_SINCE";

/** Every business code the coach discovery RPCs raise. */
export const COACH_PROFILE_ERRORS = [
  "PROFILE_INCOMPLETE",
  "ACCOUNT_UNAVAILABLE",
  "NO_COACH_PROFILE",
  "PROFILE_LOCKED",
  "NOT_DRAFT",
  "BAD_TRANSITION",
  "SLUG_RESERVED",
  "SLUG_TAKEN",
  "TOO_MANY_SPECIALIZATIONS",
  "UNKNOWN_SPECIALIZATION",
  "TOO_MANY_LANGUAGES",
  "UNKNOWN_LANGUAGE",
  "TOO_MANY_LOCATIONS",
  "UNKNOWN_CITY",
  "GYM_NAME_TOO_LONG",
  "GYM_NOT_FOUND",
  "COACH_NOT_FOUND",
  "CANNOT_REQUEST_SELF",
  "NOT_ACCEPTING_CLIENTS",
  "UNKNOWN_SERVICE",
  "ALREADY_COACHED",
  "ALREADY_HAS_COACH",
  "MESSAGE_TOO_LONG",
  "REQUEST_RATE",
  "REQUEST_PENDING",
  "REQUEST_NOT_PENDING",
  "LAST_ACTIVE_SERVICE",
  "BAD_ORDER",
  "BAD_TRANSITION",
  "CANNOT_SAVE_SELF",
  "GOAL_TOO_LONG",
  "INVALID_FORMAT",
  "REQUEST_NOT_ACCEPTED",
  "CLIENT_LIMIT",
  // request → conversation (20261104100000)
  "REQUEST_NOT_FOUND",
  "CONVERSATION_CLOSED",
  // staged revisions (20261108100000)
  "NO_REVISION",
  "INVALID_REVISION",
] as const;
export type CoachProfileErrorCode = (typeof COACH_PROFILE_ERRORS)[number];

/**
 * The coach-level Voinic verification (20261101100000). "verified" is the only
 * state that earns the Voinic Verified badge; the public sees nothing else.
 */
export const COACH_VERIFICATION_STATUSES = ["unverified", "pending", "verified", "rejected"] as const;
export type CoachVerificationStatus = (typeof COACH_VERIFICATION_STATUSES)[number];
export type CredentialStatus = "unverified" | "pending" | "verified" | "rejected";

/**
 * The business code inside a Supabase error, if it is one of ours. SLUG_TAKEN
 * is the unique index on coach_profiles.slug, which raises no code of its own.
 */
export function coachProfileErrorCode(error: { message: string } | null): CoachProfileErrorCode | null {
  if (!error) return null;
  if (error.message.includes("coach_profiles_slug_idx")) return "SLUG_TAKEN";
  return COACH_PROFILE_ERRORS.find((code) => error.message.includes(code)) ?? null;
}

// ---------- rows the owner reads (RLS: owner or admin) ----------

export type CoachProfileRow = {
  id: string;
  user_id: string;
  slug: string;
  headline: string | null;
  about: string | null;
  cover_url: string | null;
  coaching_since: number | null;
  accepting_clients: boolean;
  online: boolean;
  in_person: boolean;
  status: CoachProfileStatus;
  submitted_at: string | null;
  reviewed_at: string | null;
  /** Why an admin sent it back to draft. The owner's, never public. */
  review_note: string | null;
  published_at: string | null;
  suspended_at: string | null;
  suspension_reason: string | null;
  created_at: string;
  updated_at: string;
  verification_status: CoachVerificationStatus;
  verification_requested_at: string | null;
  verification_message: string | null;
  verification_decided_at: string | null;
  /** The admin's reason after a rejection — shown to the coach only. */
  verification_note: string | null;
};

export type CoachServiceRow = {
  id: string;
  coach_profile_id: string;
  name: string;
  description: string | null;
  kind: ServiceKind;
  delivery: ServiceDelivery;
  /** Both set or both null: "60 minutes", "12 weeks". */
  duration_value: number | null;
  duration_unit: DurationUnit | null;
  /** Minor units (bani / cents). Null = price on request (or free). */
  price_cents: number | null;
  currency: string;
  price_unit: PriceUnit;
  price_public: boolean;
  active: boolean;
  sort_order: number;
};

/** document_ref and admin_note are not readable through the API at all. */
export type CoachCertificationRow = {
  id: string;
  coach_profile_id: string;
  name: string;
  issuer: string | null;
  year: number | null;
  verification_status: CredentialStatus;
  verified_at: string | null;
  /** Owner and admins only; never on the public page. */
  credential_number: string | null;
  /** ISO date. */
  expires_on: string | null;
  sort_order: number;
};

export type CoachVerificationRow = {
  id: string;
  coach_profile_id: string;
  kind: VerificationKind;
  status: "pending" | "verified" | "rejected" | "revoked";
  verified_at: string | null;
};

export type CoachingRequestRow = {
  id: string;
  client_id: string;
  coach_id: string;
  service_id: string | null;
  message: string | null;
  status: CoachingRequestStatus;
  decline_reason: string | null;
  resolved_at: string | null;
  trainer_client_id: string | null;
  created_at: string;
};

// ---------- reference data ----------

export type Specialization = { id: string; slug: string; name_en: string; name_ro: string; sort_order: number };
export type Language = { code: string; name_en: string; name_ro: string; native_name: string; sort_order: number };
export type City = {
  id: string; slug: string; name: string; name_en: string | null; country_code: string;
  latitude: number | null; longitude: number | null;
};

export type Country = { code: string; slug: string; name_en: string; name_ro: string };

export type CoachCatalog = {
  specializations: Specialization[];
  languages: Language[];
  cities: City[];
  countries: Country[];
};

/** Everything the profile editor needs, one object. */
export type MyCoachProfile = {
  profile: CoachProfileRow;
  specializations: { slug: string; is_primary: boolean }[];
  languages: string[];
  locations: { city_slug: string; gym_name: string | null; gym_id: string | null }[];
  services: CoachServiceRow[];
  certifications: CoachCertificationRow[];
  verifications: CoachVerificationRow[];
  missing: CoachProfileMissing[];
  /**
   * An open staged revision of a published / hidden profile (20261108100000):
   * the lists and content above are then the copy's, the live page unchanged.
   */
  revision?: import("./coach-revision").CoachRevisionInfo | null;
};

// ---------- the public contract: coach_public_profile(slug) ----------
// Adding a key in SQL publishes it; adding one here does not.

export type CoachPublicProfile = {
  id: string;
  /** Only for a signed-in viewer (follow / request buttons); null for anon. */
  user_id: string | null;
  slug: string;
  display_name: string;
  username: string | null;
  avatar_url: string | null;
  cover_url: string | null;
  headline: string | null;
  about: string | null;
  coaching_since: number | null;
  accepting_clients: boolean;
  online: boolean;
  in_person: boolean;
  published_at: string | null;
  followers: number;
  /**
   * Social proof the coach's own privacy settings allow (20261021100000):
   * workouts / badges only when stats_visibility is public, the Fitness Score
   * only when fitness_score_visibility is public; null otherwise. Absent in a
   * preview built from the draft.
   */
  stats?: { posts: number; programs?: number; workouts: number | null; badges: number | null; fitness_score: number | null };
  /** Voinic Verified: the coach-level decision (20261101100000). Absent in older payloads = false. */
  verified?: boolean;
  /** What was checked, only ever non-empty when verified. */
  badges: VerificationBadge[];
  specializations: { slug: string; name_en: string; name_ro: string; is_primary: boolean }[];
  languages: { code: string; name_en: string; name_ro: string; native_name: string }[];
  locations: {
    city_slug: string; city: string; city_en: string;
    country_code: string; country_en: string; country_ro: string; gym_name: string | null;
  }[];
  certifications: { name: string; issuer: string | null; year?: number | null; expires_on?: string | null; verified: boolean }[];
  services: {
    id: string; name: string; description: string | null; kind: ServiceKind; price_unit: PriceUnit;
    delivery: ServiceDelivery; duration_value: number | null; duration_unit: DurationUnit | null;
    price_public: boolean;
    /** Null when the price is private or on request. */
    price_cents: number | null;
    currency: string | null;
  }[];
};

/** One row of coach_public_posts(): a public post, text and counts, no pictures. */
export type CoachPublicPost = {
  id: string;
  type: string;
  text: string | null;
  created_at: string;
  reactions: number;
  comments: number;
  photos: number;
};

/** coach_viewer_state(): what the page's buttons need to know about a signed-in reader. */
export type CoachViewerState = {
  is_self: boolean;
  is_following: boolean;
  follows_me: boolean;
  /** In the reader's private shortlist (20261102100000). */
  is_saved?: boolean;
  is_client: boolean;
  has_other_coach: boolean;
  pending_request: { id: string; service_id: string | null; created_at: string } | null;
  /** The reader's latest request to this coach, any state (20261103100000). */
  last_request?: { id: string; status: CoachingRequestStatus; service_id: string | null; created_at: string; started: boolean } | null;
  /** The reader's own coaching with this coach, current first (20261109110000) — the CTA's source of truth. */
  relationship?: { id: string; status: "active" | "paused" | "ended"; started_at: string; paused_at: string | null; ended_at: string | null } | null;
};
