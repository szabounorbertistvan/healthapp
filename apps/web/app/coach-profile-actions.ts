"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { liveUser } from "@/lib/supabase/server";
import { mutated } from "@/lib/supabase/mutate";
import { notSignedIn } from "@/lib/action-result";
import { id, parseInput } from "@/lib/validate";
import {
  COACH_LIMITS, PRICE_UNITS, SERVICE_KINDS, coachProfileErrorCode, isValidCoachSlug,
  type CoachProfileMissing,
} from "@/lib/coach-profile";
import {
  COVER_PUBLIC_ID, CloudinaryNotConfiguredError, cloudinaryConfigured, coverFolder, coverUrl,
  destroyCover, signCoverUpload, type AvatarUploadTicket,
} from "@/lib/cloudinary";
import type { ActionResult } from "./actions";

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
  if (Object.keys(patch).length === 0) return { ok: true };

  const live = await liveUser();
  if (!live) return notSignedIn;
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
  const { error } = await live.supabase.rpc("coach_set_languages", { p_codes: parsed.data });
  if (error) return failure(error);
  revalidateCoach();
  return { ok: true };
}

const LocationsInput = z.array(z.object({
  city: z.string().max(60),
  gymName: z.string().max(COACH_LIMITS.gymName).nullable().optional(),
}).strict()).max(COACH_LIMITS.locations);

export async function setCoachLocations(locations: z.input<typeof LocationsInput>): Promise<ActionResult> {
  const parsed = await parseInput(LocationsInput, locations);
  if (!parsed.ok) return parsed.result;
  const live = await liveUser();
  if (!live) return notSignedIn;
  const { error } = await live.supabase.rpc("coach_set_locations", {
    p_locations: parsed.data.map((l) => ({ city: l.city, gym_name: l.gymName?.trim() || null })),
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
  /** Minor units; null = on request. */
  priceCents: z.number().int().min(0).max(100_000_000).nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/).default("RON"),
  priceUnit: z.enum(PRICE_UNITS),
  pricePublic: z.boolean().default(true),
  active: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(1000).default(0),
}).strict();
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
    price_cents: s.priceCents,
    currency: s.currency,
    price_unit: s.priceUnit,
    price_public: s.pricePublic,
    active: s.active,
    sort_order: s.sortOrder,
  };

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
  const result = await mine.live.supabase
    .from("coach_services").delete({ count: "exact" }).eq("id", parsed.data).eq("coach_profile_id", mine.profileId);
  if (result.error) return failure(result.error);
  const failed = await mutated(result);
  if (failed) return failed;
  revalidateCoach();
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
  const row = { name, issuer: c.issuer?.trim() || null, year: c.year ?? null, sort_order: c.sortOrder };

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

// ---------- lifecycle ----------

/**
 * draft → pending_review. When something is missing nothing changes and the
 * list comes back, so the editor can point at every gap at once.
 */
export async function submitCoachForReview(): Promise<ActionResult & { missing?: CoachProfileMissing[] }> {
  const live = await liveUser();
  if (!live) return notSignedIn;
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
