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
 */
const TABLES: { table: string; column: string }[] = [
  { table: "trainer_clients", column: "client_id" },
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
];

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

  const [account, programs, plans, conversations, ...rest] = await Promise.all([
    supabase.from("users").select("*").eq("id", userId).single(),
    supabase
      .from("programs")
      .select("*, program_days(*, program_exercises(*))")
      .eq("client_id", userId),
    supabase
      .from("nutrition_plans")
      .select("*, planned_meals(*, planned_meal_foods(*))")
      .eq("client_id", userId),
    supabase.from("conversations").select("*").eq("client_id", userId),
    ...TABLES.map((t) => supabase.from(t.table).select("*").eq(t.column, userId)),
  ]);

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

  rest.forEach((result, i) => {
    const { table } = TABLES[i]!;
    out[table] = result.data ?? [];
    if (result.error) errors[table] = result.error.message;
  });

  if (Object.keys(errors).length > 0) out._errors = errors;
  return out;
}
