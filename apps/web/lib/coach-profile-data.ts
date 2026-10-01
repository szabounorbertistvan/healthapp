import "server-only";
import { liveUser, supabasePublic } from "@/lib/supabase/server";
import type {
  City, CoachCertificationRow, CoachProfileMissing, CoachProfileRow, CoachPublicProfile,
  CoachServiceRow, CoachVerificationRow, Language, MyCoachProfile, Specialization,
} from "@/lib/coach-profile";

// Coach Discovery reads. Writes live in app/coach-profile-actions.ts.

const PROFILE_COLUMNS =
  "id, user_id, slug, headline, about, cover_url, coaching_since, accepting_clients, online, in_person, " +
  "status, submitted_at, reviewed_at, review_note, published_at, suspended_at, suspension_reason, created_at, updated_at";
const SERVICE_COLUMNS =
  "id, coach_profile_id, name, description, kind, price_cents, currency, price_unit, price_public, active, sort_order";
// Exactly the granted columns: document_ref and admin_note are not readable.
const CERTIFICATION_COLUMNS = "id, coach_profile_id, name, issuer, year, verification_status, verified_at, sort_order";
const VERIFICATION_COLUMNS = "id, coach_profile_id, kind, status, verified_at";

/**
 * The signed-in coach's own profile with everything the editor shows, or null
 * when they have none yet (become_coach() not called). Two waves: the profile,
 * then its children and the submit checklist in parallel.
 */
export async function getMyCoachProfile(): Promise<MyCoachProfile | null> {
  const live = await liveUser();
  if (!live) return null;
  const { supabase, userId } = live;

  const { data: profile, error } = await supabase
    .from("coach_profiles")
    .select(PROFILE_COLUMNS)
    .eq("user_id", userId)
    .maybeSingle<CoachProfileRow>();
  if (error) throw new Error(`coach profile: ${error.message}`);
  if (!profile) return null;

  const [specs, langs, locs, services, certs, verifications, missing] = await Promise.all([
    supabase.from("coach_specializations").select("is_primary, specializations(slug)").eq("coach_profile_id", profile.id),
    supabase.from("coach_languages").select("language_code").eq("coach_profile_id", profile.id),
    supabase.from("coach_locations").select("gym_name, cities(slug)").eq("coach_profile_id", profile.id),
    supabase.from("coach_services").select(SERVICE_COLUMNS).eq("coach_profile_id", profile.id).order("sort_order"),
    supabase.from("coach_certifications").select(CERTIFICATION_COLUMNS).eq("coach_profile_id", profile.id).order("sort_order"),
    supabase.from("coach_verifications").select(VERIFICATION_COLUMNS).eq("coach_profile_id", profile.id),
    supabase.rpc("coach_profile_missing"),
  ]);
  for (const r of [specs, langs, locs, services, certs, verifications, missing]) {
    if (r.error) throw new Error(`coach profile: ${r.error.message}`);
  }

  // PostgREST types an embedded to-one as an object; no generated types here.
  type Embedded = { slug: string } | { slug: string }[] | null;
  const slugOf = (e: Embedded) => (Array.isArray(e) ? e[0]?.slug : e?.slug) ?? "";

  return {
    profile,
    specializations: ((specs.data ?? []) as { is_primary: boolean; specializations: Embedded }[])
      .map((s) => ({ slug: slugOf(s.specializations), is_primary: s.is_primary })),
    languages: ((langs.data ?? []) as { language_code: string }[]).map((l) => l.language_code),
    locations: ((locs.data ?? []) as { gym_name: string | null; cities: Embedded }[])
      .map((l) => ({ city_slug: slugOf(l.cities), gym_name: l.gym_name })),
    services: (services.data ?? []) as CoachServiceRow[],
    certifications: (certs.data ?? []) as CoachCertificationRow[],
    verifications: (verifications.data ?? []) as CoachVerificationRow[],
    missing: (missing.data ?? []) as CoachProfileMissing[],
  };
}

/** The pick lists for the editor: active specializations, languages and cities. */
export async function getCoachCatalog(): Promise<{
  specializations: Specialization[]; languages: Language[]; cities: City[];
}> {
  const live = await liveUser();
  if (!live) return { specializations: [], languages: [], cities: [] };
  const { supabase } = live;
  const [specs, langs, cities] = await Promise.all([
    supabase.from("specializations").select("id, slug, name_en, name_ro, sort_order").eq("active", true).order("sort_order"),
    supabase.from("languages").select("code, name_en, name_ro, native_name, sort_order").eq("active", true).order("sort_order"),
    supabase.from("cities").select("id, slug, name, name_en, country_code, latitude, longitude").eq("active", true).order("name"),
  ]);
  for (const r of [specs, langs, cities]) {
    if (r.error) throw new Error(`coach catalog: ${r.error.message}`);
  }
  return {
    specializations: (specs.data ?? []) as Specialization[],
    languages: (langs.data ?? []) as Language[],
    cities: (cities.data ?? []) as City[],
  };
}

/**
 * A published coach page as an anonymous visitor sees it — the same thing a
 * crawler gets. Null for anything not published. No cookie is read, so the
 * caller can cache it.
 */
export async function getPublicCoachProfile(slug: string): Promise<CoachPublicProfile | null> {
  const { data, error } = await supabasePublic().rpc("coach_public_profile", { p_slug: slug });
  if (error) throw new Error(`public coach profile: ${error.message}`);
  return (data as CoachPublicProfile | null) ?? null;
}
