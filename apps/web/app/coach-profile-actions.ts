"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { liveUser } from "@/lib/supabase/server";
import { mutated } from "@/lib/supabase/mutate";
import { notSignedIn } from "@/lib/action-result";
import { id, parseInput } from "@/lib/validate";
import {
  COACH_LIMITS, DURATION_UNITS, PRICE_UNITS, SERVICE_DELIVERY, SERVICE_KINDS, coachProfileErrorCode, isValidCoachSlug,
  type CoachProfileMissing,
} from "@/lib/coach-profile";
import { CURRENCIES, takesPrice } from "@/lib/coach-onboarding";
import { CLIENT_GOALS, CONTENT_LIMITS, MAX_CLIENT_GOALS, SOCIAL_NETWORKS, cleanClientGoals, cleanSocialLinks } from "@/lib/coach-content";
import {
  COVER_PUBLIC_ID, CloudinaryNotConfiguredError, cloudinaryConfigured, coverFolder, coverUrl,
  destroyCover, signCoverUpload, type AvatarUploadTicket,
} from "@/lib/cloudinary";
import type { ActionResult } from "./actions";
import {
  withCertification, withLocations, withService, withServiceOrder, withSpecializations, withoutCertification, withoutService,
  type RevisionPayload,
} from "@/lib/coach-revision";
import { getPlan } from "@/lib/plan";

// Coach Discovery writes: the coach's own profile, saved a piece at a time
// while it is a draft. The database decides everything that matters — only a
// draft is editable (PROFILE_LOCKED otherwise), only become_coach() creates a
// profile, only the lifecycle RPCs move `status`, and only an admin publishes.
// What these actions add is the shape check (lib/validate.ts) and turning a
// raised code into an `errorCode` a screen can switch on.
//
// Nothing here has been driven against the live project yet: the migration
// (20261020100000) is not applied there. pgTAP covers the SQL side.

/** The editor lives under the coach's settings; the public page under /coaches. */
function revalidateCoach(slug?: string) {
  revalidatePath("/settings", "layout");
  if (slug) revalidatePath(`/coaches/${slug}`);
}

function failure(error: { message: string }): ActionResult {
  const code = coachProfileErrorCode(error);
  if (code) return { ok: false, errorCode: code, message: code };
  console.error("coach profile write failed:", error.message);
  return { ok: false, message: error.message };
}

// ---------- staged revisions (20261108100000) ----------
// A published or hidden profile is edited as a copy: while one is open, every
// content write below patches the copy and saves it whole
// (coach_revision_save, which judges it with the real tables) — the live page
// does not change until an admin approves. Operational switches (accepting,
// hide / show, service on/off and order on the live list, booking settings)
// still act on the live profile.

type Live = NonNullable<Awaited<ReturnType<typeof liveUser>>>;

/** The open copy, or null (a draft, no revision open, or a database without revisions yet). */
async function openRevision(live: Live): Promise<RevisionPayload | null> {
  const { data, error } = await live.supabase.rpc("coach_my_revision_payload");
  if (error) return null;
  return (data ?? null) as RevisionPayload | null;
}

async function saveRevision(live: Live, payload: RevisionPayload): Promise<ActionResult> {
  const { error } = await live.supabase.rpc("coach_revision_save", { p_payload: payload });
  if (error) return failure(error);
  revalidateCoach();
  return { ok: true };
}

async function myProfile(): Promise<{ live: NonNullable<Awaited<ReturnType<typeof liveUser>>>; profileId: string; slug: string } | ActionResult> {
  const live = await liveUser();
  if (!live) return notSignedIn;
  const { data, error } = await live.supabase
    .from("coach_profiles").select("id, slug").eq("user_id", live.userId).maybeSingle<{ id: string; slug: string }>();
  if (error) return failure(error);
  if (!data) return { ok: false, errorCode: "NO_COACH_PROFILE", message: "NO_COACH_PROFILE" };
  return { live, profileId: data.id, slug: data.slug };
}

// ---------- becoming a coach ----------

/** client → both, plus a draft profile. Idempotent. */
export async function becomeCoach(): Promise<ActionResult & { profileId?: string }> {
  const live = await liveUser();
  if (!live) return notSignedIn;
  const { data, error } = await live.supabase.rpc("become_coach");
  if (error) return failure(error);
  // The role changed, and both shells read it from the layout.
  revalidatePath("/", "layout");
  return { ok: true, profileId: data as string };
}

// ---------- the profile's own fields ----------

const DraftInput = z.object({
  slug: z.string().max(COACH_LIMITS.slugMax).optional(),
  headline: z.string().max(COACH_LIMITS.headline).optional(),
  about: z.string().max(COACH_LIMITS.about).optional(),
  coachingSince: z.number().int().min(1950).max(2100).nullable().optional(),
  acceptingClients: z.boolean().optional(),
  online: z.boolean().optional(),
  inPerson: z.boolean().optional(),
  // own-words content (20261111100000)
  approach: z.string().max(CONTENT_LIMITS.approach).optional(),
  experienceSummary: z.string().max(CONTENT_LIMITS.experienceSummary).optional(),
  clientGoals: z.array(z.enum(CLIENT_GOALS)).max(MAX_CLIENT_GOALS).optional(),
  socialLinks: z.partialRecord(z.enum(SOCIAL_NETWORKS), z.string().max(300)).optional(),
}).strict();
export type CoachDraftFields = z.input<typeof DraftInput>;

/**
 * Save whichever fields the step sent; the rest stay as they are. A draft may
 * be as incomplete as the coach likes — completeness is checked on submit.
 * accepting_clients is the one field that may change after submitting.
 */
export async function saveCoachProfileDraft(input: CoachDraftFields): Promise<ActionResult> {
  const parsed = await parseInput(DraftInput, input);
  if (!parsed.ok) return parsed.result;
  const f = parsed.data;

  const patch: Record<string, unknown> = {};
  if (f.slug !== undefined) {
    const slug = f.slug.trim().toLowerCase();
    if (!isValidCoachSlug(slug)) return { ok: false, errorCode: "INVALID_INPUT", message: "SLUG" };
    patch.slug = slug;
  }
  if (f.headline !== undefined) patch.headline = f.headline.trim() || null;
  if (f.about !== undefined) patch.about = f.about.trim() || null;
  if (f.coachingSince !== undefined) {
    if (f.coachingSince !== null && f.coachingSince > new Date().getFullYear()) {
      return { ok: false, errorCode: "INVALID_INPUT", message: "COACHING_SINCE" };
    }
    patch.coaching_since = f.coachingSince;
  }
  if (f.acceptingClients !== undefined) patch.accepting_clients = f.acceptingClients;
  if (f.online !== undefined) patch.online = f.online;
  if (f.inPerson !== undefined) patch.in_person = f.inPerson;
  if (f.approach !== undefined) patch.approach = f.approach.trim() || null;
  if (f.experienceSummary !== undefined) patch.experience_summary = f.experienceSummary.trim() || null;
  if (f.clientGoals !== undefined) patch.client_goals = cleanClientGoals(f.clientGoals);
  if (f.socialLinks !== undefined) {
    // handles only: a pasted profile URL is reduced to its handle; anything still invalid names its network
    const { links, invalid } = cleanSocialLinks(f.socialLinks);
    if (invalid) return { ok: false, errorCode: "INVALID_INPUT", message: `SOCIAL:${invalid}` };
    patch.social_links = links;
  }
  if (Object.keys(patch).length === 0) return { ok: true };

  const live = await liveUser();
  if (!live) return notSignedIn;
  const rev = await openRevision(live);
  if (rev) {
    // the public URL is not part of a revision
    if (patch.slug !== undefined) return { ok: false, errorCode: "PROFILE_LOCKED", message: "PROFILE_LOCKED" };
    if (patch.accepting_clients !== undefined) {
      const done = await live.supabase.from("coach_profiles")
        .update({ accepting_clients: patch.accepting_clients }, { count: "exact" }).eq("user_id", live.userId);
      if (done.error) return failure(done.error);
      delete patch.accepting_clients;
      if (Object.keys(patch).length === 0) {
        revalidateCoach();
        return { ok: true };
      }
    }
    return saveRevision(live, {
      ...rev,
      ...(patch.headline !== undefined ? { headline: patch.headline as string | null } : {}),
      ...(patch.about !== undefined ? { about: patch.about as string | null } : {}),
      ...(patch.coaching_since !== undefined ? { coaching_since: patch.coaching_since as number | null } : {}),
      ...(patch.online !== undefined ? { online: patch.online as boolean } : {}),
      ...(patch.in_person !== undefined ? { in_person: patch.in_person as boolean } : {}),
      ...(patch.approach !== undefined ? { approach: patch.approach as string | null } : {}),
      ...(patch.experience_summary !== undefined ? { experience_summary: patch.experience_summary as string | null } : {}),
      ...(patch.client_goals !== undefined ? { client_goals: patch.client_goals as RevisionPayload["client_goals"] } : {}),
      ...(patch.social_links !== undefined ? { social_links: patch.social_links as RevisionPayload["social_links"] } : {}),
    });
  }
  const result = await live.supabase
    .from("coach_profiles").update(patch, { count: "exact" }).eq("user_id", live.userId);
  if (result.error) return failure(result.error);
  const failed = await mutated(result);
  if (failed) return failed;
  revalidateCoach(typeof patch.slug === "string" ? patch.slug : undefined);
  return { ok: true };
}

// ---------- the sets: specializations, languages, locations ----------
// Replaced whole: the step sends what is ticked.

export async function setCoachSpecializations(slugs: string[], primary: string | null): Promise<ActionResult> {
  const parsed = await parseInput(
    z.tuple([z.array(z.string().max(60)).max(COACH_LIMITS.specializations), z.string().max(60).nullable()]),
    [slugs, primary],
  );
  if (!parsed.ok) return parsed.result;
  const live = await liveUser();
  if (!live) return notSignedIn;
  const rev = await openRevision(live);
  if (rev) return saveRevision(live, withSpecializations(rev, parsed.data[0], parsed.data[1]));
  const { error } = await live.supabase.rpc("coach_set_specializations", {
    p_slugs: parsed.data[0], p_primary: parsed.data[1],
  });
  if (error) return failure(error);
  revalidateCoach();
  return { ok: true };
}

export async function setCoachLanguages(codes: string[]): Promise<ActionResult> {
  const parsed = await parseInput(z.array(z.string().regex(/^[a-z]{2,3}$/)).max(COACH_LIMITS.languages), codes);
  if (!parsed.ok) return parsed.result;
  const live = await liveUser();
  if (!live) return notSignedIn;
  const rev = await openRevision(live);
  if (rev) return saveRevision(live, { ...rev, languages: parsed.data });
  const { error } = await live.supabase.rpc("coach_set_languages", { p_codes: parsed.data });
  if (error) return failure(error);
  revalidateCoach();
  return { ok: true };
}

const LocationsInput = z.array(z.object({
  city: z.string().max(60),
  gymName: z.string().max(COACH_LIMITS.gymName).nullable().optional(),
  gymId: id.nullable().optional(),
}).strict()).max(COACH_LIMITS.locations);

export async function setCoachLocations(locations: z.input<typeof LocationsInput>): Promise<ActionResult> {
  const parsed = await parseInput(LocationsInput, locations);
  if (!parsed.ok) return parsed.result;
  const live = await liveUser();
  if (!live) return notSignedIn;
  const rev = await openRevision(live);
  if (rev) return saveRevision(live, withLocations(rev, parsed.data));
  const { error } = await live.supabase.rpc("coach_set_locations", {
    p_locations: parsed.data.map((l) => ({ city: l.city, gym_id: l.gymId ?? null, gym_name: l.gymName?.trim() || null })),
  });
  if (error) return failure(error);
  revalidateCoach();
  return { ok: true };
}

// ---------- services ----------

const ServiceInput = z.object({
  id: id.optional(),
  name: z.string().max(COACH_LIMITS.serviceName),
  description: z.string().max(COACH_LIMITS.serviceDescription).nullable().optional(),
  kind: z.enum(SERVICE_KINDS),
  delivery: z.enum(SERVICE_DELIVERY).default("online"),
  durationValue: z.number().int().min(1).max(1000).nullable().default(null),
  durationUnit: z.enum(DURATION_UNITS).nullable().default(null),
  /** Minor units; null = on request (or free). */
  priceCents: z.number().int().min(0).max(100_000_000).nullable(),
  currency: z.enum(CURRENCIES).default("RON"),
  priceUnit: z.enum(PRICE_UNITS),
  pricePublic: z.boolean().default(true),
  active: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(1000).default(0),
}).strict()
  // the same rules as the table's constraints, so a bad form never reaches the database
  .refine((s) => (s.durationValue === null) === (s.durationUnit === null), { message: "SERVICE_DURATION" })
  .refine((s) => takesPrice(s.priceUnit) ? s.priceCents !== null : true, { message: "SERVICE_PRICE" })
  .refine((s) => s.priceUnit !== "free" || !s.priceCents, { message: "SERVICE_FREE_PRICE" });
export type CoachServiceInput = z.input<typeof ServiceInput>;

/** Insert (no id) or update (id) one service. Drafts only — RLS refuses otherwise. */
export async function saveCoachService(input: CoachServiceInput): Promise<ActionResult & { id?: string }> {
  const parsed = await parseInput(ServiceInput, input);
  if (!parsed.ok) return parsed.result;
  const s = parsed.data;
  const name = s.name.trim();
  if (!name) return { ok: false, errorCode: "INVALID_INPUT", message: "SERVICE_NAME" };

  const mine = await myProfile();
  if (!("profileId" in mine)) return mine;
  const { live, profileId } = mine;
  const row = {
    name,
    description: s.description?.trim() || null,
    kind: s.kind,
    delivery: s.delivery,
    duration_value: s.durationValue,
    duration_unit: s.durationUnit,
    // free and on-request carry no price
    price_cents: takesPrice(s.priceUnit) ? s.priceCents : null,
    currency: s.currency,
    price_unit: s.priceUnit,
    price_public: s.pricePublic,
    active: s.active,
    sort_order: s.sortOrder,
  };

  const rev = await openRevision(live);
  if (rev) {
    // a new service gets its id now: the editor keeps editing it by id, and approval inserts it with that id
    const sid = s.id ?? crypto.randomUUID();
    if (s.id && !rev.services.some((x) => x.id === s.id)) return { ok: false, errorCode: "NO_ROWS", message: "NO_ROWS" };
    const saved = await saveRevision(live, withService(rev, { id: sid, ...row }));
    return saved.ok ? { ok: true, id: sid } : saved;
  }
  if (!s.id) {
    const { data, error } = await live.supabase
      .from("coach_services").insert({ ...row, coach_profile_id: profileId }).select("id").single<{ id: string }>();
    if (error) return failure(error);
    revalidateCoach();
    return { ok: true, id: data.id };
  }
  const result = await live.supabase
    .from("coach_services").update(row, { count: "exact" }).eq("id", s.id).eq("coach_profile_id", profileId);
  if (result.error) return failure(result.error);
  const failed = await mutated(result);
  if (failed) return failed;
  revalidateCoach();
  return { ok: true, id: s.id };
}

export async function deleteCoachService(serviceId: string): Promise<ActionResult> {
  const parsed = await parseInput(id, serviceId);
  if (!parsed.ok) return parsed.result;
  const mine = await myProfile();
  if (!("profileId" in mine)) return mine;
  const rev = await openRevision(mine.live);
  if (rev) return saveRevision(mine.live, withoutService(rev, parsed.data));
  const result = await mine.live.supabase
    .from("coach_services").delete({ count: "exact" }).eq("id", parsed.data).eq("coach_profile_id", mine.profileId);
  if (result.error) return failure(result.error);
  const failed = await mutated(result);
  if (failed) return failed;
  revalidateCoach();
  return { ok: true };
}

/**
 * Write the order the coach arranged (coach_reorder_services, 20261031100000):
 * one call, the whole list, in any status but suspended — order is operational,
 * not content, so a published coach reorders without a new review. The list
 * must be exactly the coach's services (BAD_ORDER otherwise).
 */
export async function reorderCoachServices(serviceIds: string[]): Promise<ActionResult> {
  const parsed = await parseInput(z.array(id).max(50), serviceIds);
  if (!parsed.ok) return parsed.result;
  const mine = await myProfile();
  if (!("profileId" in mine)) return mine;
  const rev = await openRevision(mine.live);
  if (rev) {
    const ordered = withServiceOrder(rev, parsed.data);
    if (!ordered) return { ok: false, errorCode: "BAD_ORDER", message: "BAD_ORDER" };
    return saveRevision(mine.live, ordered);
  }
  const { error } = await mine.live.supabase.rpc("coach_reorder_services", { p_ids: parsed.data });
  if (error) return failure(error);
  revalidateCoach(mine.slug);
  return { ok: true };
}

/**
 * Offer a service or stop offering it (coach_set_service_active). Like the
 * order, an operational switch: allowed while published or hidden, with the
 * public page following at once. LAST_ACTIVE_SERVICE when it would leave a
 * non-draft profile with nothing on offer.
 */
export async function setCoachServiceActive(serviceId: string, active: boolean): Promise<ActionResult> {
  const parsed = await parseInput(z.object({ serviceId: id, active: z.boolean() }).strict(), { serviceId, active });
  if (!parsed.ok) return parsed.result;
  const mine = await myProfile();
  if (!("profileId" in mine)) return mine;
  const rev = await openRevision(mine.live);
  if (rev) {
    const svc = rev.services.find((x) => x.id === parsed.data.serviceId);
    if (!svc) return { ok: false, errorCode: "NO_ROWS", message: "NO_ROWS" };
    return saveRevision(mine.live, withService(rev, { ...svc, active: parsed.data.active }));
  }
  const { error } = await mine.live.supabase.rpc("coach_set_service_active", {
    p_service: parsed.data.serviceId, p_active: parsed.data.active,
  });
  if (error) return failure(error);
  revalidateCoach(mine.slug);
  revalidatePath("/coaches");
  return { ok: true };
}

// ---------- certifications ----------
// The coach writes name / issuer / year. Verification is an admin's; renaming
// a verified certificate resets it (trigger). Documents are not uploaded yet.

const CertificationInput = z.object({
  id: id.optional(),
  name: z.string().max(COACH_LIMITS.certificationName),
  issuer: z.string().max(COACH_LIMITS.certificationIssuer).nullable().optional(),
  year: z.number().int().min(1950).max(2100).nullable().optional(),
  /** Owner and admins only (20261101100000); never public. */
  credentialNumber: z.string().max(80).nullable().optional(),
  /** ISO date, 1950..2100. */
  expiresOn: z.string().regex(/^(19[5-9]\d|20\d\d|2100)-\d{2}-\d{2}$/).nullable().optional(),
  sortOrder: z.number().int().min(0).max(1000).default(0),
}).strict();
export type CoachCertificationInput = z.input<typeof CertificationInput>;

export async function saveCoachCertification(input: CoachCertificationInput): Promise<ActionResult & { id?: string }> {
  const parsed = await parseInput(CertificationInput, input);
  if (!parsed.ok) return parsed.result;
  const c = parsed.data;
  const name = c.name.trim();
  if (!name) return { ok: false, errorCode: "INVALID_INPUT", message: "CERTIFICATION_NAME" };

  const mine = await myProfile();
  if (!("profileId" in mine)) return mine;
  const { live, profileId } = mine;
  const row = {
    name, issuer: c.issuer?.trim() || null, year: c.year ?? null, sort_order: c.sortOrder,
    credential_number: c.credentialNumber?.trim() || null, expires_on: c.expiresOn || null,
  };

  const rev = await openRevision(live);
  if (rev) {
    const cid = c.id ?? crypto.randomUUID();
    if (c.id && !rev.certifications.some((x) => x.id === c.id)) return { ok: false, errorCode: "NO_ROWS", message: "NO_ROWS" };
    const saved = await saveRevision(live, withCertification(rev, { id: cid, ...row }));
    return saved.ok ? { ok: true, id: cid } : saved;
  }
  if (!c.id) {
    const { data, error } = await live.supabase
      .from("coach_certifications").insert({ ...row, coach_profile_id: profileId }).select("id").single<{ id: string }>();
    if (error) return failure(error);
    revalidateCoach();
    return { ok: true, id: data.id };
  }
  const result = await live.supabase
    .from("coach_certifications").update(row, { count: "exact" }).eq("id", c.id).eq("coach_profile_id", profileId);
  if (result.error) return failure(result.error);
  const failed = await mutated(result);
  if (failed) return failed;
  revalidateCoach();
  return { ok: true, id: c.id };
}

export async function deleteCoachCertification(certificationId: string): Promise<ActionResult> {
  const parsed = await parseInput(id, certificationId);
  if (!parsed.ok) return parsed.result;
  const mine = await myProfile();
  if (!("profileId" in mine)) return mine;
  const rev = await openRevision(mine.live);
  if (rev) return saveRevision(mine.live, withoutCertification(rev, parsed.data));
  const result = await mine.live.supabase
    .from("coach_certifications").delete({ count: "exact" }).eq("id", parsed.data).eq("coach_profile_id", mine.profileId);
  if (result.error) return failure(result.error);
  const failed = await mutated(result);
  if (failed) return failed;
  revalidateCoach();
  return { ok: true };
}

// ---------- cover image ----------
// Same flow as the avatar (profile-actions.ts): a signed ticket, the browser
// posts straight to Cloudinary, then reports back and the URL is rebuilt here.

export async function requestCoverUpload(): Promise<ActionResult & { ticket?: AvatarUploadTicket }> {
  const live = await liveUser();
  if (!live) return notSignedIn;
  try {
    return { ok: true, ticket: signCoverUpload(live.userId) };
  } catch (error) {
    if (error instanceof CloudinaryNotConfiguredError) {
      console.error(error.message);
      return { ok: false, message: error.message };
    }
    throw error;
  }
}

export async function saveCover(input: { publicId: string; version: number }): Promise<ActionResult> {
  const parsed = await parseInput(z.object({ publicId: z.string().max(200), version: z.number().int().positive() }).strict(), input);
  if (!parsed.ok) return parsed.result;
  const mine = await myProfile();
  if (!("profileId" in mine)) return mine;
  const { live } = mine;
  // The id is fixed per person, so anything else is not an upload this server signed.
  if (parsed.data.publicId !== `${coverFolder(live.userId)}/${COVER_PUBLIC_ID}`) {
    return { ok: false, message: "Unexpected upload path" };
  }
  const result = await live.supabase
    .from("coach_profiles")
    .update({ cover_url: coverUrl(parsed.data.publicId, parsed.data.version) }, { count: "exact" })
    .eq("user_id", live.userId);
  if (result.error) return failure(result.error);
  const failed = await mutated(result);
  if (failed) return failed;
  revalidateCoach();
  return { ok: true };
}

export async function removeCover(): Promise<ActionResult> {
  const live = await liveUser();
  if (!live) return notSignedIn;
  const result = await live.supabase
    .from("coach_profiles").update({ cover_url: null }, { count: "exact" }).eq("user_id", live.userId);
  if (result.error) return failure(result.error);
  const failed = await mutated(result);
  if (failed) return failed;
  // The column is the record; a failed Cloudinary call must not undo the removal.
  if (cloudinaryConfigured()) {
    try {
      await destroyCover(live.userId);
    } catch (error) {
      console.error("cover asset not removed:", (error as Error).message);
    }
  }
  revalidateCoach();
  return { ok: true };
}

// ---------- coaching requests ----------

/**
 * "Start coaching" on a public coach page. The database decides everything:
 * published, accepting clients, not yourself, not already their client, one
 * pending request per coach, a daily cap (request_coaching()).
 */
export async function requestCoaching(input: {
  profileId: string;
  serviceId: string | null;
  message: string;
  goal?: string | null;
  format?: "online" | "in_person" | "hybrid" | null;
  slug: string;
}): Promise<ActionResult & { requestId?: string }> {
  const parsed = await parseInput(z.object({
    profileId: id,
    serviceId: id.nullable(),
    // the contact form asks for a message (20261103100000); the gym's quick ask may leave it out
    message: z.string().trim().min(1).max(COACH_LIMITS.requestMessage),
    goal: z.string().trim().max(300).nullable().optional(),
    format: z.enum(["online", "in_person", "hybrid"]).nullable().optional(),
    slug: z.string().max(COACH_LIMITS.slugMax),
  }).strict(), input);
  if (!parsed.ok) return parsed.result;
  const live = await liveUser();
  if (!live) return notSignedIn;
  const { data, error } = await live.supabase.rpc("request_coaching", {
    p_coach_profile: parsed.data.profileId,
    p_service: parsed.data.serviceId,
    p_message: parsed.data.message,
    p_goal: parsed.data.goal || null,
    p_format: parsed.data.format ?? null,
  });
  if (error) return failure(error);
  revalidatePath(`/coaches/${parsed.data.slug}`);
  revalidatePath("/coaches/requests");
  return { ok: true, requestId: data as string };
}

/** The client takes back a request that is still pending (cancel_coaching_request()). */
export async function cancelCoachingRequest(input: { requestId: string; slug: string }): Promise<ActionResult> {
  const parsed = await parseInput(z.object({ requestId: id, slug: z.string().max(COACH_LIMITS.slugMax) }).strict(), input);
  if (!parsed.ok) return parsed.result;
  const live = await liveUser();
  if (!live) return notSignedIn;
  const { error } = await live.supabase.rpc("cancel_coaching_request", { p_request: parsed.data.requestId });
  if (error) return failure(error);
  revalidatePath(`/coaches/${parsed.data.slug}`);
  return { ok: true };
}

// ---------- lifecycle ----------

/**
 * draft → pending_review. When something is missing nothing changes and the
 * list comes back, so the editor can point at every gap at once.
 */
export async function submitCoachForReview(): Promise<ActionResult & { missing?: CoachProfileMissing[] }> {
  const live = await liveUser();
  if (!live) return notSignedIn;
  // an open revision is submitted as changes; the live page stays up meanwhile
  if (await openRevision(live)) {
    const sent = await live.supabase.rpc("coach_revision_submit");
    if (sent.error) return failure(sent.error);
    const open = (sent.data ?? []) as CoachProfileMissing[];
    if (open.length > 0) return { ok: false, errorCode: "PROFILE_INCOMPLETE", message: "PROFILE_INCOMPLETE", missing: open };
    revalidateCoach();
    revalidatePath("/marketplace");
    return { ok: true };
  }
  const { data, error } = await live.supabase.rpc("submit_coach_for_review");
  if (error) return failure(error);
  const missing = (data ?? []) as CoachProfileMissing[];
  if (missing.length > 0) return { ok: false, errorCode: "PROFILE_INCOMPLETE", message: "PROFILE_INCOMPLETE", missing };
  revalidateCoach();
  return { ok: true };
}

/** published | pending_review → draft. A published page goes offline until an admin approves it again. */
export async function withdrawCoachProfile(): Promise<ActionResult> {
  const mine = await myProfile();
  if (!("profileId" in mine)) return mine;
  const { error } = await mine.live.supabase.rpc("withdraw_coach_profile");
  if (error) return failure(error);
  revalidateCoach(mine.slug);
  return { ok: true };
}

// ---------- verification (20261101100000) ----------

/**
 * Ask Voinic to verify this coach: unverified | rejected → pending. Never
 * verifies anything — only an admin can (admin_set_coach_verification_status).
 * A profile that is not complete gets its missing items back instead.
 */
export async function requestCoachVerification(message: string): Promise<ActionResult & { missing?: CoachProfileMissing[] }> {
  const parsed = await parseInput(z.string().max(1000), message ?? "");
  if (!parsed.ok) return parsed.result;
  const mine = await myProfile();
  if (!("profileId" in mine)) return mine;
  const { data, error } = await mine.live.supabase.rpc("request_coach_verification", { p_message: parsed.data.trim() || null });
  if (error) return failure(error);
  const missing = (data ?? []) as CoachProfileMissing[];
  if (missing.length > 0) return { ok: false, errorCode: "PROFILE_INCOMPLETE", message: "PROFILE_INCOMPLETE", missing };
  revalidateCoach(mine.slug);
  return { ok: true };
}

// ---------- hide / show (20261029100000) ----------

/** Discovery and the coach's page: both change the moment a profile hides or shows. */
function revalidateDiscovery(slug: string) {
  revalidateCoach(slug);
  revalidatePath("/coaches");
}

/** published → hidden: out of discovery at once; the account, posts and programs are untouched. */
export async function hideCoachProfile(): Promise<ActionResult> {
  const mine = await myProfile();
  if (!("profileId" in mine)) return mine;
  const { error } = await mine.live.supabase.rpc("hide_coach_profile");
  if (error) return failure(error);
  revalidateDiscovery(mine.slug);
  return { ok: true };
}

/**
 * hidden → published, without a new review (the content could not change
 * while hidden). The database re-runs the checklist; what is missing comes
 * back instead of an error, and the profile stays hidden.
 */
export async function showCoachProfile(): Promise<ActionResult & { missing?: CoachProfileMissing[] }> {
  const mine = await myProfile();
  if (!("profileId" in mine)) return mine;
  const { data, error } = await mine.live.supabase.rpc("show_coach_profile");
  if (error) return failure(error);
  const missing = (data ?? []) as CoachProfileMissing[];
  if (missing.length > 0) return { ok: false, errorCode: "PROFILE_INCOMPLETE", message: "PROFILE_INCOMPLETE", missing };
  revalidateDiscovery(mine.slug);
  return { ok: true };
}

// ---------- saved coaches (20261102100000) ----------

/**
 * Save a coach to the reader's private shortlist, or take them off it. The
 * database decides: one save per coach (a second tap that loses the race is
 * answered as saved), never yourself (CANNOT_SAVE_SELF), never a coach the
 * reader cannot see (the insert policy). Nobody else ever reads a save.
 */
export async function toggleCoachSave(profileId: string, saved: boolean): Promise<ActionResult & { saved?: boolean }> {
  const parsed = await parseInput(z.object({ profileId: id, saved: z.boolean() }).strict(), { profileId, saved });
  if (!parsed.ok) return parsed.result;
  const live = await liveUser();
  if (!live) return notSignedIn;
  const { supabase, userId } = live;
  if (parsed.data.saved) {
    const { error } = await supabase.from("coach_saves").delete()
      .eq("user_id", userId).eq("coach_profile_id", parsed.data.profileId);
    if (error) return failure(error);
    revalidatePath("/coaches/saved");
    return { ok: true, saved: false };
  }
  const { error } = await supabase.from("coach_saves").insert({ user_id: userId, coach_profile_id: parsed.data.profileId });
  if (error && error.code !== "23505") return failure(error);
  revalidatePath("/coaches/saved");
  return { ok: true, saved: true };
}

// ---------- the coach answers (20261103100000) ----------

const REQUEST_PATHS = ["/requests", "/dashboard", "/clients", "/coaches/requests"];
function requestsTouched() {
  for (const path of REQUEST_PATHS) revalidatePath(path);
}

/** pending → accepted: "let's talk". Makes nobody a client; the client is notified. */
export async function acceptCoachingRequest(requestId: string): Promise<ActionResult> {
  const parsed = await parseInput(id, requestId);
  if (!parsed.ok) return parsed.result;
  const live = await liveUser();
  if (!live) return notSignedIn;
  const { error } = await live.supabase.rpc("accept_coaching_request", { p_request: parsed.data });
  if (error) return failure(error);
  requestsTouched();
  return { ok: true };
}

/** pending → declined; the client is notified. */
export async function declineCoachingRequest(requestId: string): Promise<ActionResult> {
  const parsed = await parseInput(id, requestId);
  if (!parsed.ok) return parsed.result;
  const live = await liveUser();
  if (!live) return notSignedIn;
  const { error } = await live.supabase.rpc("decline_coaching_request", { p_request: parsed.data, p_reason: null });
  if (error) return failure(error);
  requestsTouched();
  return { ok: true };
}

/**
 * "Message coach" / "Message client" on an accepted request
 * (open_request_conversation, 20261104100000): the pair's one conversation —
 * the existing one if there is any, otherwise created now, empty. Sends
 * nothing and changes nothing about the request. The caller picks the route
 * for its side: /coach/messages/[id] for the client, /messages/[id] for the coach.
 */
export async function openRequestConversation(requestId: string): Promise<ActionResult & { conversationId?: string }> {
  const parsed = await parseInput(id, requestId);
  if (!parsed.ok) return parsed.result;
  const live = await liveUser();
  if (!live) return notSignedIn;
  const { data, error } = await live.supabase.rpc("open_request_conversation", { p_request: parsed.data });
  if (error) return failure(error);
  revalidatePath("/messages");
  return { ok: true, conversationId: data as string };
}

/**
 * The explicit second step on an accepted request: the person becomes this
 * coach's client (start_coaching_from_request — one active coach per client),
 * within the coach's plan limit, like an invite.
 */
export async function startCoachingFromRequest(requestId: string): Promise<ActionResult> {
  const parsed = await parseInput(id, requestId);
  if (!parsed.ok) return parsed.result;
  const live = await liveUser();
  if (!live) return notSignedIn;
  const [plan, { count }] = await Promise.all([
    getPlan(),
    live.supabase.from("trainer_clients").select("id", { count: "exact", head: true })
      .eq("coach_id", live.userId).eq("status", "active"),
  ]);
  if ((count ?? 0) >= plan.e.maxClients) return { ok: false, errorCode: "CLIENT_LIMIT", message: "CLIENT_LIMIT" };
  const { error } = await live.supabase.rpc("start_coaching_from_request", { p_request: parsed.data });
  if (error) return failure(error);
  requestsTouched();
  revalidatePath("/messages");
  return { ok: true };
}

/**
 * "Edit profile" on a published or hidden profile (20261108100000): open a
 * copy of what is live. The public page stays exactly as it is until an
 * admin approves the copy; reopening returns the copy already started.
 */
export async function startCoachRevision(): Promise<ActionResult> {
  const live = await liveUser();
  if (!live) return notSignedIn;
  const { error } = await live.supabase.rpc("coach_revision_start");
  if (error) return failure(error);
  revalidateCoach();
  return { ok: true };
}

/** Throw the copy away. The live page never changed. */
export async function discardCoachRevision(): Promise<ActionResult> {
  const live = await liveUser();
  if (!live) return notSignedIn;
  const { error } = await live.supabase.rpc("coach_revision_discard");
  if (error) return failure(error);
  revalidateCoach();
  revalidatePath("/marketplace");
  return { ok: true };
}
