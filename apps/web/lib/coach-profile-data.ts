import "server-only";
import { cache } from "react";
import type { RoutineCard } from "@healthapp/shared";
import { currentUserId, liveUser, supabasePublic, supabaseServer } from "@/lib/supabase/server";
import { toCards } from "@/lib/routine-data";
import {
  searchArgs, type CoachSearchResult, type DiscoveryFacets, type DiscoveryQuery,
} from "@/lib/coach-discovery";
import type {
  City, CoachCertificationRow, CoachProfileMissing, CoachProfileRow, CoachPublicProfile,
  CoachCatalog, CoachPublicPost, CoachServiceRow, CoachVerificationRow, CoachViewerState, Country, Language,
  MyCoachProfile, Specialization,
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
    supabase.from("coach_locations").select("gym_name, gym_id, cities(slug)").eq("coach_profile_id", profile.id),
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
    locations: ((locs.data ?? []) as { gym_name: string | null; gym_id: string | null; cities: Embedded }[])
      .map((l) => ({ city_slug: slugOf(l.cities), gym_name: l.gym_name, gym_id: l.gym_id })),
    services: (services.data ?? []) as CoachServiceRow[],
    certifications: (certs.data ?? []) as CoachCertificationRow[],
    verifications: (verifications.data ?? []) as CoachVerificationRow[],
    missing: (missing.data ?? []) as CoachProfileMissing[],
  };
}

/** The pick lists for the editor: active specializations, languages, cities and countries. */
export async function getCoachCatalog(): Promise<CoachCatalog> {
  const live = await liveUser();
  if (!live) return { specializations: [], languages: [], cities: [], countries: [] };
  const { supabase } = live;
  const [specs, langs, cities, countries] = await Promise.all([
    supabase.from("specializations").select("id, slug, name_en, name_ro, sort_order").eq("active", true).order("sort_order"),
    supabase.from("languages").select("code, name_en, name_ro, native_name, sort_order").eq("active", true).order("sort_order"),
    supabase.from("cities").select("id, slug, name, name_en, country_code, latitude, longitude").eq("active", true).order("name"),
    supabase.from("countries").select("code, slug, name_en, name_ro").eq("active", true).order("name_en"),
  ]);
  for (const r of [specs, langs, cities, countries]) {
    if (r.error) throw new Error(`coach catalog: ${r.error.message}`);
  }
  return {
    specializations: (specs.data ?? []) as Specialization[],
    languages: (langs.data ?? []) as Language[],
    cities: (cities.data ?? []) as City[],
    countries: (countries.data ?? []) as Country[],
  };
}

/**
 * A published coach page. Anonymous: through a client with no session (what a
 * crawler gets, cacheable). Signed in: through the reader's own session, so
 * the block rule applies to them and user_id comes back for the buttons.
 * Null for anything not published. Cached per request: the page and its
 * generateMetadata share one call.
 */
export const getPublicCoachProfile = cache(async (slug: string): Promise<CoachPublicProfile | null> => {
  const signedIn = Boolean(await currentUserId());
  const client = signedIn ? await supabaseServer() : supabasePublic();
  const { data, error } = await client.rpc("coach_public_profile", { p_slug: slug });
  if (error) throw new Error(`public coach profile: ${error.message}`);
  return (data as CoachPublicProfile | null) ?? null;
});

/** The coach's `public` posts, text and counts (for a reader who is not signed in). */
export async function getPublicCoachPosts(slug: string, limit = 3): Promise<CoachPublicPost[]> {
  const { data, error } = await supabasePublic().rpc("coach_public_posts", { p_slug: slug, p_limit: limit });
  if (error) throw new Error(`public coach posts: ${error.message}`);
  return (data ?? []) as CoachPublicPost[];
}

/** The coach's `public` routines as Discover cards (for a reader who is not signed in). */
export async function getPublicCoachPrograms(slug: string, limit = 6): Promise<RoutineCard[]> {
  const { data, error } = await supabasePublic().rpc("coach_public_programs", { p_slug: slug, p_limit: limit });
  if (error) throw new Error(`public coach programs: ${error.message}`);
  return toCards(data);
}

/** What the page's buttons need about the signed-in reader; null when nobody is signed in. */
export async function getCoachViewerState(profileId: string): Promise<CoachViewerState | null> {
  const live = await liveUser();
  if (!live) return null;
  const { data, error } = await live.supabase.rpc("coach_viewer_state", { p_profile: profileId });
  if (error) throw new Error(`coach viewer state: ${error.message}`);
  return (data as CoachViewerState | null) ?? null;
}

/** Just the status of the signed-in user's coach profile (null = none), for the settings cards. */
export async function getMyCoachProfileStatus(): Promise<CoachProfileRow["status"] | null> {
  const live = await liveUser();
  if (!live) return null;
  const { data, error } = await live.supabase
    .from("coach_profiles").select("status").eq("user_id", live.userId).maybeSingle<{ status: CoachProfileRow["status"] }>();
  if (error) {
    // Before the migration reaches a project the table does not exist; the card just offers "become a coach".
    console.error(`coach profile status: ${error.message}`);
    return null;
  }
  return data?.status ?? null;
}

// ---------- discovery (/coaches) ----------

/** A signed-in reader goes through their own session (blocks apply); anyone else through the public client. */
async function discoveryClient() {
  return (await currentUserId()) ? await supabaseServer() : supabasePublic();
}

/** One page of coach cards — every filter, the order and the total in one RPC (search_coaches). */
export async function searchCoaches(query: DiscoveryQuery): Promise<CoachSearchResult> {
  const client = await discoveryClient();
  const { data, error } = await client.rpc("search_coaches", searchArgs(query));
  if (error) throw new Error(`coach search: ${error.message}`);
  const result = data as CoachSearchResult | null;
  return { total: result?.total ?? 0, items: result?.items ?? [] };
}

/** What the filters offer: specializations, and the countries / cities that have a published coach. */
export async function getDiscoveryFacets(): Promise<DiscoveryFacets> {
  const { data, error } = await supabasePublic().rpc("coach_discovery_facets");
  if (error) throw new Error(`coach facets: ${error.message}`);
  const f = data as Partial<DiscoveryFacets> | null;
  return { specializations: f?.specializations ?? [], countries: f?.countries ?? [], cities: f?.cities ?? [] };
}
