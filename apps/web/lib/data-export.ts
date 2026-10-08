import "server-only";
import { liveUser } from "./supabase/server";

/**
 * GDPR art. 15/20 — everything this account has produced, as one JSON document
 * the person can keep or hand to another service.
 *
 * Three rules shape the list below.
 *
 * 1. **Explicit ownership filters, never a bare `select("*")`.** RLS would
 *    already narrow most of these, but not all: a client can read the posts of
 *    people they follow, so an unfiltered social_posts read would export other
 *    people's data into their file. The filter column is named per table.
 * 2. **Children travel with their parent.** program_days, program_exercises,
 *    planned_meals and planned_meal_foods carry no user column at all — they
 *    are reachable only through the program or plan, so they are embedded
 *    rather than queried on their own.
 * 3. **A failed table is reported, not silently dropped.** An export that
 *    quietly loses a table is worse than one that says which table it could not
 *    read, so errors land in `_errors` and the caller still gets the rest.
 *
 * A row the account is a party to on either side (a booking, a request, a
 * relationship) lists every column it can sit in; the read matches any of
 * them. Left out on purpose: the marketplace ranking signals and visit events
 * (internal scores and hashed visitors, not this person's data), push
 * subscription keys, and quota counters. Calendar OAuth tokens live in a
 * service-role-only table and never reach this code.
 *
 * Ten tables have no select grant at all (barcode scans, reports filed, the
 * sign-up's attribution, calendar data, certifications, verifications, profile
 * revisions, old slugs): export_my_restricted_data() (20261113120000) returns
 * the caller's rows of those, without moderation internals.
 */
const TABLES: { table: string; column: string | string[] }[] = [
  { table: "trainer_clients", column: ["client_id", "coach_id"] },
  { table: "coaching_requests", column: ["client_id", "coach_id"] },
  { table: "coaching_relationship_events", column: "actor_id" },
  { table: "bookings", column: ["client_id", "coach_id"] },
  { table: "logged_sessions", column: "user_id" },
  { table: "logged_sets", column: "user_id" },
  { table: "food_logs", column: "user_id" },
  { table: "food_favorites", column: "user_id" },
  { table: "measurements", column: "user_id" },
  { table: "check_ins", column: "user_id" },
  { table: "progress_photos", column: "user_id" },
  { table: "goals", column: "user_id" },
  { table: "habits", column: "user_id" },
  { table: "habit_logs", column: "user_id" },
  { table: "streaks", column: "user_id" },
  { table: "user_badges", column: "user_id" },
  { table: "challenge_participants", column: "user_id" },
  { table: "workout_events", column: "user_id" },
  { table: "adherence_snapshots", column: "user_id" },
  { table: "coach_feedback", column: "client_id" },
  { table: "subscriptions", column: "user_id" },
  { table: "notifications", column: "user_id" },
  { table: "messages", column: "sender_id" },
  { table: "social_posts", column: "user_id" },
  { table: "social_comments", column: "user_id" },
  { table: "social_reactions", column: "user_id" },
  { table: "social_follows", column: "follower_id" },
  // Content the account authored rather than logged: custom exercises and
  // foods belong to whoever made them, so they travel with the export too.
  { table: "exercises", column: "owner_id" },
  { table: "foods", column: "owner_id" },
  { table: "exercise_videos", column: "owner_id" },
  { table: "set_videos", column: "user_id" },
  { table: "exercise_video_links", column: "user_id" },
  { table: "program_saves", column: "user_id" },
  { table: "challenges", column: "creator_id" },
  { table: "feedback", column: "user_id" },
  { table: "account_deletion_requests", column: "user_id" },
  // Social, beyond the posts themselves.
  { table: "social_stories", column: "user_id" },
  { table: "social_story_views", column: "viewer_id" },
  { table: "social_post_media", column: "user_id" },
  { table: "social_post_saves", column: "user_id" },
  { table: "social_user_blocks", column: "blocker_id" },
  { table: "social_user_mutes", column: "muter_id" },
  // Coach Discovery, from the reader's side and the coach's.
  { table: "coach_saves", column: "user_id" },
  { table: "coach_reviews", column: ["reviewer_id", "coach_id"] },
  { table: "gyms", column: "suggested_by" },
  { table: "coach_availability", column: "coach_id" },
  { table: "coach_availability_exceptions", column: "coach_id" },
];

/** The coach profile's own rows, keyed by the profile rather than the user. */
const PROFILE_TABLES = [
  "coach_services",
  "coach_languages",
  "coach_specializations",
  "coach_locations",
] as const;

export type DataExport = {
  exported_at: string;
  account: unknown;
  /** Tables that could not be read, so a gap is visible rather than silent. */
  _errors?: Record<string, string>;
} & Record<string, unknown>;

export async function exportMyData(): Promise<DataExport | null> {
  const live = await liveUser();
  if (!live) return null;
  const { supabase, userId } = live;

  const [account, programs, plans, conversations, profile, restricted, ...rest] = await Promise.all([
    supabase.from("users").select("*").eq("id", userId).single(),
    supabase
      .from("programs")
      .select("*, program_days(*, program_exercises(*))")
      .or(`client_id.eq.${userId},coach_id.eq.${userId}`),
    supabase
      .from("nutrition_plans")
      .select("*, planned_meals(*, planned_meal_foods(*))")
      .or(`client_id.eq.${userId},coach_id.eq.${userId}`),
    supabase.from("conversations").select("*").or(`client_id.eq.${userId},coach_id.eq.${userId}`),
    supabase.from("coach_profiles").select("*").eq("user_id", userId).maybeSingle(),
    supabase.rpc("export_my_restricted_data"),
    ...TABLES.map((t) =>
      typeof t.column === "string"
        ? supabase.from(t.table).select("*").eq(t.column, userId)
        : supabase.from(t.table).select("*").or(t.column.map((c) => `${c}.eq.${userId}`).join(",")),
    ),
  ]);

  // Only a coach has a profile; its rows hang off the profile id, one wave later.
  const profileId = (profile.data as { id?: string } | null)?.id;
  const profileRows = profileId
    ? await Promise.all(
        PROFILE_TABLES.map((table) => supabase.from(table).select("*").eq("coach_profile_id", profileId)),
      )
    : [];

  const errors: Record<string, string> = {};
  const out: DataExport = {
    exported_at: new Date().toISOString(),
    account: account.data ?? null,
    programs: programs.data ?? [],
    nutrition_plans: plans.data ?? [],
    conversations: conversations.data ?? [],
  };
  if (account.error) errors.users = account.error.message;
  if (programs.error) errors.programs = programs.error.message;
  if (plans.error) errors.nutrition_plans = plans.error.message;
  if (conversations.error) errors.conversations = conversations.error.message;
  if (profile.error) errors.coach_profiles = profile.error.message;
  if (restricted.error) errors.export_my_restricted_data = restricted.error.message;
  Object.assign(out, (restricted.data as Record<string, unknown> | null) ?? {});
  out.coach_profile = profile.data ?? null;
  profileRows.forEach((result, i) => {
    const table = PROFILE_TABLES[i]!;
    out[table] = result.data ?? [];
    if (result.error) errors[table] = result.error.message;
  });

  rest.forEach((result, i) => {
    const { table } = TABLES[i]!;
    out[table] = result.data ?? [];
    if (result.error) errors[table] = result.error.message;
  });

  if (Object.keys(errors).length > 0) out._errors = errors;
  return out;
}
