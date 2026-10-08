import "server-only";
import { overlayRevision, type CoachRevisionInfo, type RevisionPayload } from "./coach-revision";
import { cache } from "react";
import type { RoutineCard } from "@healthapp/shared";
import { currentUserId, liveUser, supabasePublic, supabaseServer } from "@/lib/supabase/server";
import { toCards } from "@/lib/routine-data";
import {
  searchArgs, type CoachSearchResult, type DiscoveryFacets, type DiscoveryQuery,
} from "@/lib/coach-discovery";
import type {
  City, CoachCertificationRow, CoachProfileMissing, CoachProfileRow, CoachPublicProfile,
  CoachCatalog, CoachPublicPost, CoachServiceRow, CoachVerificationRow, CoachViewerState, CoachingRequestStatus, Country, Language,
  MyCoachProfile, Specialization,
} from "@/lib/coach-profile";

// Coach Discovery reads. Writes live in app/coach-profile-actions.ts.

const BASE_PROFILE_COLUMNS =
  "id, user_id, slug, headline, about, cover_url, coaching_since, accepting_clients, online, in_person, " +
  "status, submitted_at, reviewed_at, review_note, published_at, suspended_at, suspension_reason, created_at, updated_at, " +
  "verification_status, verification_requested_at, verification_message, verification_decided_at, verification_note";
// own-words content (20261111100000); read only where the database has it — see getMyCoachProfile
const PROFILE_COLUMNS = `${BASE_PROFILE_COLUMNS}, approach, experience_summary, client_goals, social_links`;
const SERVICE_COLUMNS =
  "id, coach_profile_id, name, description, kind, delivery, duration_value, duration_unit, price_cents, currency, price_unit, price_public, active, sort_order";
// Exactly the granted columns: document_ref and admin_note are not readable.
const CERTIFICATION_COLUMNS = "id, coach_profile_id, name, issuer, year, credential_number, expires_on, verification_status, verified_at, sort_order";
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

  let { data: profile, error } = await supabase
    .from("coach_profiles")
    .select(PROFILE_COLUMNS)
    .eq("user_id", userId)
    .maybeSingle<CoachProfileRow>();
  // a database without 20261111100000 (42703: no such column): the editor still works, without the new fields
  if (error?.code === "42703") {
    ({ data: profile, error } = await supabase
      .from("coach_profiles").select(BASE_PROFILE_COLUMNS).eq("user_id", userId).maybeSingle<CoachProfileRow>());
  }
  if (error) throw new Error(`coach profile: ${error.message}`);
  if (!profile) return null;

  // a published or hidden profile may have a staged revision open (20261108100000)
  const isLive = profile.status === "published" || profile.status === "hidden";
  const [specs, langs, locs, services, certs, verifications, missing, revision] = await Promise.all([
    supabase.from("coach_specializations").select("is_primary, specializations(slug)").eq("coach_profile_id", profile.id),
    supabase.from("coach_languages").select("language_code").eq("coach_profile_id", profile.id),
    supabase.from("coach_locations").select("gym_name, gym_id, cities(slug)").eq("coach_profile_id", profile.id),
    supabase.from("coach_services").select(SERVICE_COLUMNS).eq("coach_profile_id", profile.id).order("sort_order"),
    supabase.from("coach_certifications").select(CERTIFICATION_COLUMNS).eq("coach_profile_id", profile.id).order("sort_order"),
    supabase.from("coach_verifications").select(VERIFICATION_COLUMNS).eq("coach_profile_id", profile.id),
    supabase.rpc("coach_profile_missing"),
    isLive ? supabase.rpc("coach_my_revision") : Promise.resolve({ data: null, error: null }),
  ]);
  for (const r of [specs, langs, locs, services, certs, verifications, missing]) {
    if (r.error) throw new Error(`coach profile: ${r.error.message}`);
  }
  // a database without revisions yet (PGRST202) simply has none open
  if (revision.error && revision.error.code !== "PGRST202") throw new Error(`coach revision: ${revision.error.message}`);

  // PostgREST types an embedded to-one as an object; no generated types here.
  type Embedded = { slug: string } | { slug: string }[] | null;
  const slugOf = (e: Embedded) => (Array.isArray(e) ? e[0]?.slug : e?.slug) ?? "";

  const mine: MyCoachProfile = {
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
    revision: null,
  };
  const rev = revision.data as { status: CoachRevisionInfo["status"]; review_note: string | null; submitted_at: string | null;
                                 payload: RevisionPayload; missing: CoachProfileMissing[] } | null;
  if (!rev) return mine;
  // the editor works on the copy; the live page is untouched until an admin approves it
  return {
    ...overlayRevision(mine, rev.payload),
    missing: rev.missing,
    revision: { status: rev.status, review_note: rev.review_note, submitted_at: rev.submitted_at },
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

/**
 * One page of coach cards — every filter, the order and the total in one RPC
 * (search_coaches). `limit` overrides the page size (the Discovery Home's
 * short rows); the total is the whole result either way.
 */
export async function searchCoaches(query: DiscoveryQuery, limit?: number): Promise<CoachSearchResult> {
  const client = await discoveryClient();
  const args = searchArgs(query);
  const { data, error } = await client.rpc("search_coaches", limit ? { ...args, p_limit: limit } : args);
  if (error) throw new Error(`coach search: ${error.message}`);
  const result = data as CoachSearchResult | null;
  return { total: result?.total ?? 0, items: result?.items ?? [] };
}

/**
 * The signed-in reader's saved coaches (/coaches/saved): search_coaches() with
 * p_saved — the same cards, the same visibility (a coach who went hidden or
 * suspended simply is not there), most recently saved first, one call.
 * Everyone published counts, taking clients or not.
 */
export async function getSavedCoaches(limit = 100): Promise<CoachSearchResult> {
  const live = await liveUser();
  if (!live) return { total: 0, items: [] };
  const { data, error } = await live.supabase.rpc("search_coaches", {
    p_saved: true, p_accepting: false, p_sort: "saved", p_limit: limit, p_offset: 0, p_currency: "RON",
  });
  if (error) throw new Error(`saved coaches: ${error.message}`);
  const result = data as CoachSearchResult | null;
  return { total: result?.total ?? 0, items: result?.items ?? [] };
}

/**
 * What the filters offer: specializations (with counts), the countries /
 * cities / gyms that have a published coach, the languages they speak and
 * the kinds of service they offer. Cached per request: a landing page's
 * metadata and body share one call.
 */
export const getDiscoveryFacets = cache(async (): Promise<DiscoveryFacets> => {
  const { data, error } = await supabasePublic().rpc("coach_discovery_facets");
  if (error) throw new Error(`coach facets: ${error.message}`);
  const f = data as Partial<DiscoveryFacets> | null;
  return {
    specializations: f?.specializations ?? [], countries: f?.countries ?? [], cities: f?.cities ?? [], gyms: f?.gyms ?? [],
    languages: f?.languages ?? [], service_kinds: f?.service_kinds ?? [],
  };
});

// ---------- contact requests (20261103100000) ----------

export type CoachRequestRow = {
  id: string; status: CoachingRequestStatus; client_id: string; client_name: string; client_username: string | null;
  client_avatar: string | null; service_name: string | null; message: string | null; goal: string | null;
  preferred_format: "online" | "in_person" | "hybrid" | null; gym_name: string | null;
  created_at: string; resolved_at: string | null; started: boolean;
  /** What a started request became, as it stands now (20261109110000). */
  relationship_status?: "active" | "paused" | "ended" | null;
};
export type MyCoachingRequestRow = {
  id: string; status: CoachingRequestStatus; coach_name: string; coach_slug: string | null; coach_avatar: string | null;
  service_name: string | null; message: string | null; goal: string | null;
  preferred_format: "online" | "in_person" | "hybrid" | null;
  created_at: string; resolved_at: string | null; started: boolean;
  relationship_status?: "active" | "paused" | "ended" | null;
};

/** The signed-in coach's requests, pending first (coach_requests()). */
export async function getCoachRequests(status: CoachingRequestStatus | null = null): Promise<CoachRequestRow[]> {
  const live = await liveUser();
  if (!live) return [];
  const { data, error } = await live.supabase.rpc("coach_requests", { p_status: status });
  if (error) throw new Error(`coach requests: ${error.message}`);
  return (data ?? []) as CoachRequestRow[];
}

/** The signed-in reader's sent requests, pending first (my_coaching_requests()). */
export async function getMyCoachingRequests(): Promise<MyCoachingRequestRow[]> {
  const live = await liveUser();
  if (!live) return [];
  const { data, error } = await live.supabase.rpc("my_coaching_requests");
  if (error) throw new Error(`my requests: ${error.message}`);
  return (data ?? []) as MyCoachingRequestRow[];
}

/**
 * The current slug for an old one (coach_slug_redirect(), 20261107100000),
 * only while that coach is public; null otherwise. A shared link outlives a
 * slug change. A database without the function yet answers null.
 */
export async function getCoachSlugRedirect(slug: string): Promise<string | null> {
  const { data, error } = await supabasePublic().rpc("coach_slug_redirect", { p_slug: slug });
  if (error?.code === "PGRST202") return null;
  if (error) throw new Error(`coach slug redirect: ${error.message}`);
  return (data as string | null) ?? null;
}
