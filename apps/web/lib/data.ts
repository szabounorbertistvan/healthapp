// Server-side data access. Everything goes through Supabase under RLS.
import "server-only";
import { cache } from "react";
import { liveUser, supabaseServer } from "./supabase/server";
import { effectiveTier, isLengthUnit, isWeightUnit, normalizeRestPrefs, portionMacros, sumMacros } from "@healthapp/shared";
import { LOAD_SET_SELECT, loadOf, toLoadSet, type LoadSetJoin } from "./training-load";
import type {
  CheckInRow, ClientRow, ConversationRow, DashboardRow,
  MessageRow, NutritionPlanDetail, NutritionPlanRow, Profile, ProgramDetail, ProgramRow,
} from "./types";
import type { Role, Tier } from "./entitlements";

export const getProfile = cache(async (): Promise<Profile | null> => {
  const live = await liveUser();
  if (!live) return null;
  const { supabase, userId } = live;
  const [{ data: user }, { data: sub, error: planError }] = await Promise.all([
    supabase.from("users").select("id, full_name, username, avatar_url, city, bio, sex, birth_year, timezone, check_in_weekday, leaderboard_visibility, weight_unit, length_unit, rest_prefs, role, suspended_at").eq("id", userId).single(),
    // my_plan (migration 20260923120000): the effective tier including one
    // inherited from a Coach Pro, and whether the paywall applies — a
    // definer view, because the coach's subscription is a row this person
    // cannot read. Same wave as before; it replaced a subscriptions select.
    supabase.from("my_plan")
      .select("tier, own_tier, paywall, trial_ends_at, has_stripe")
      .maybeSingle(),
  ]);
  if (!user) return null;
  if (planError) console.error(`my_plan read failed: ${planError.message}`);
  const role = user.role as Role;
  const plan = sub as { tier: Tier | null; own_tier: Tier | null; paywall: boolean | null; trial_ends_at: string | null; has_stripe: boolean | null } | null;
  return {
    id: user.id,
    full_name: user.full_name ?? "Coach",
    username: (user.username as string | null) ?? null,
    avatar_url: (user.avatar_url as string | null) ?? null,
    city: (user.city as string | null) ?? null,
    bio: (user.bio as string | null) ?? null,
    sex: (user.sex as Profile["sex"]) ?? null,
    birth_year: (user.birth_year as number | null) ?? null,
    timezone: (user.timezone as string | null) ?? "Europe/Bucharest",
    check_in_weekday: (user.check_in_weekday as number | null) ?? 1,
    weight_unit: isWeightUnit(user.weight_unit) ? user.weight_unit : "kg",
    length_unit: isLengthUnit(user.length_unit) ? user.length_unit : "cm",
    leaderboard_visibility:
      (user.leaderboard_visibility as Profile["leaderboard_visibility"] | null) ?? "public",
    rest_prefs: normalizeRestPrefs(user.rest_prefs),
    role,
    // Without the view (an unapplied migration, a failed read) the person is
    // on their role's free tier with the paywall off — every feature open,
    // exactly the app as it was before the paywall existed.
    tier: plan?.tier ?? effectiveTier(null, role),
    tier_via_coach: Boolean(plan?.tier && plan.own_tier && plan.tier !== plan.own_tier),
    paywall: plan?.paywall ?? false,
    trial_ends_at: plan?.trial_ends_at ?? null,
    has_stripe: Boolean(plan?.has_stripe),
    suspended_at: (user.suspended_at as string | null) ?? null,
  };
});

/**
 * What the shell shows for the signed-in person: their username, else the
 * first word of their name. `full_name` falls back to the email address in the
 * sign-up trigger, so an email-shaped name is cut at the @ — an address must
 * never be what greets someone.
 */
export function displayName(profile: Pick<Profile, "username" | "full_name"> | null): string {
  if (!profile) return "";
  if (profile.username) return profile.username;
  const name = profile.full_name.trim();
  if (name.includes("@")) return name.split("@")[0];
  return name.split(/\s+/)[0] || name;
}

/** Age in whole years from a birth year, or null when unknown. */
export function ageFrom(birthYear: number | null): number | null {
  if (!birthYear) return null;
  return new Date().getFullYear() - birthYear;
}

export async function getDashboard(): Promise<DashboardRow[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("coach_dashboard");
  if (error) throw error;
  return data ?? [];
}

/**
 * The coach's active clients, id and name only — for pickers (copy a program
 * to a client) that need no signals or load. One query; coach_id filtered for
 * the same admin reason as getClients below.
 */
export async function getActiveClientNames(): Promise<{ id: string; name: string }[]> {
  const live = await liveUser();
  if (!live) return [];
  const { supabase, userId } = live;
  const { data, error } = await supabase
    .from("trainer_clients")
    .select("client:users!trainer_clients_client_id_fkey(id, full_name, username)")
    .eq("coach_id", userId)
    .eq("status", "active");
  if (error) return [];
  type Person = { id: string; full_name: string; username: string | null };
  return (data ?? [])
    .map((r) => r.client as unknown as Person | null)
    .filter((c): c is Person => Boolean(c))
    .map((c) => ({ id: c.id, name: displayName(c) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getClients(): Promise<ClientRow[]> {
  const live = await liveUser();
  if (!live) return [];
  const { supabase, userId } = live;
  // Three independent reads, one wave: the roster, the dashboard RPC and the
  // week's training load. None of them needs another's result.
  //
  // coach_id is filtered here rather than left to RLS: `tc_admin_read` opens
  // the whole table to an admin, and an admin who opens the coach area is not
  // every coach's coach — unscoped, they saw other coaches' clients and every
  // write for one was refused by `is_active_coach_of()`.
  const [{ data, error }, dash, load] = await Promise.all([
    supabase
      .from("trainer_clients")
      .select("status, started_at, client:users!trainer_clients_client_id_fkey(id, full_name)")
      .eq("coach_id", userId)
      .in("status", ["invited", "active"]),
    getDashboard(),
    clientLoad7d(supabase),
  ]);
  if (error) throw error;
  const byId = new Map(dash.map((d) => [d.client_id, d]));
  return (data ?? []).map((r) => {
    const client = r.client as unknown as { id: string; full_name: string } | null;
    const d = client ? byId.get(client.id) : undefined;
    return {
      client_id: client?.id ?? "",
      full_name: client?.full_name ?? "(invite pending)",
      signal: d?.signal ?? "needs_attention",
      overall_pct: d?.overall_pct ?? 0,
      last_activity: d?.last_activity ?? null,
      status: r.status,
      started_at: r.started_at,
      load_7d: client ? (load.get(client.id) ?? 0) : 0,
    };
  });
}

/**
 * Training load per client over the last seven days. One query: RLS
 * (sessions_coach_read) already narrows it to the coach's active clients, so
 * there is nothing to filter here beyond the window.
 */
async function clientLoad7d(
  supabase: Awaited<ReturnType<typeof supabaseServer>>,
): Promise<Map<string, number>> {
  const since = new Date();
  since.setDate(since.getDate() - 6);
  since.setHours(0, 0, 0, 0);
  const { data } = await supabase
    .from("logged_sessions")
    .select(`user_id, started_at, completed_at, logged_sets(${LOAD_SET_SELECT})`)
    .not("completed_at", "is", null)
    .gte("started_at", since.toISOString());
  type Row = { user_id: string; started_at: string; completed_at: string | null; logged_sets: LoadSetJoin[] | null };
  const totals = new Map<string, number>();
  for (const s of (data ?? []) as unknown as Row[]) {
    const score = loadOf((s.logged_sets ?? []).map(toLoadSet), s.started_at, s.completed_at).score;
    totals.set(s.user_id, (totals.get(s.user_id) ?? 0) + score);
  }
  return totals;
}

export async function getCheckIns(): Promise<CheckInRow[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("check_ins")
    .select("*, user:users(id, full_name)")
    .is("coach_reviewed_at", null)
    .order("submitted_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((c) => {
    const user = c.user as unknown as { id: string; full_name: string };
    return {
      id: c.id, client_id: user.id, full_name: user.full_name,
      week_start: c.week_start, weight_kg: c.weight_kg,
      sleep: c.sleep, energy: c.energy, stress: c.stress,
      hunger: c.hunger, recovery: c.recovery, note: c.note,
      submitted_at: c.submitted_at, coach_reviewed_at: c.coach_reviewed_at,
      previous: null, // TODO: fetch previous week in one query
      context: "",
    };
  });
}

export async function getPrograms(): Promise<ProgramRow[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("programs")
    .select("id, name, status, updated_at, client:users!programs_client_id_fkey(full_name), program_days(count)")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((p) => ({
    id: p.id, name: p.name, status: p.status, updated_at: p.updated_at,
    client_name: (p.client as unknown as { full_name: string })?.full_name ?? "—",
    days: (p.program_days as unknown as { count: number }[])?.[0]?.count ?? 0,
  }));
}

export async function getProgram(id: string): Promise<ProgramDetail | null> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("programs")
    .select(`id, name, status, intensity_mode, weeks,
      client:users!programs_client_id_fkey(full_name),
      program_days(id, name, week_index, day_index, muscle_groups,
        program_exercises(id, position, target_sets, target_reps, target_weight_kg, target_rpe, rest_seconds, circuit, set_type,
          exercise:exercises(name_en, name_ro)))`)
    .eq("id", id)
    .single();
  if (error) return null;
  return {
    id: data.id, name: data.name, status: data.status,
    intensity_mode: data.intensity_mode, week: 1, weeks: data.weeks,
    client_name: (data.client as unknown as { full_name: string })?.full_name ?? "—",
    days: (data.program_days as unknown as {
      id: string; name: string; week_index: number; day_index: number; muscle_groups: string[] | null;
      program_exercises: {
        id: string; position: number; target_sets: number; target_reps: string;
        target_weight_kg: number | null; target_rpe: number | null; rest_seconds: number | null; circuit: number | null; set_type: string | null;
        exercise: { name_en: string; name_ro: string | null };
      }[];
    }[])
      // PostgREST returns embedded rows in no guaranteed order.
      .sort((a, b) => a.week_index - b.week_index || a.day_index - b.day_index)
      .map((d) => ({
      id: d.id, name: d.name,
      muscle_groups: d.muscle_groups ?? [],
      exercises: d.program_exercises
        .sort((a, b) => a.position - b.position)
        .map((e) => ({
          id: e.id, exercise: e.exercise?.name_ro ?? e.exercise?.name_en ?? "—",
          sets: e.target_sets, reps: e.target_reps,
          weight: e.target_weight_kg ? `${e.target_weight_kg} kg` : "—",
          rpe: e.target_rpe?.toString() ?? "—",
          rest: e.rest_seconds ? `${e.rest_seconds}s` : "—",
          weight_kg: e.target_weight_kg,
          rpe_value: e.target_rpe,
          rest_seconds: e.rest_seconds,
          position: e.position,
          circuit: e.circuit ?? null,
          set_type: e.set_type ?? "normal",
        })),
    })),
  };
}

export async function getNutritionPlans(): Promise<NutritionPlanRow[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("nutrition_plans")
    .select("id, name, status, kcal_target, protein_target_g, carbs_target_g, fat_target_g, client:users!nutrition_plans_client_id_fkey(full_name)")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((n) => ({
    id: n.id, name: n.name, status: n.status,
    kcal_target: n.kcal_target, protein_target_g: n.protein_target_g,
    carbs_target_g: n.carbs_target_g, fat_target_g: n.fat_target_g,
    client_name: (n.client as unknown as { full_name: string })?.full_name ?? "—",
  }));
}

export async function getConversations(): Promise<ConversationRow[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("conversations")
    .select("id, client:users!conversations_client_id_fkey(id, full_name), messages(body, created_at, read_at, sender_id)")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((c) => {
    const client = c.client as unknown as { id: string; full_name: string };
    const msgs = (c.messages as unknown as { body: string; created_at: string; read_at: string | null; sender_id: string }[]) ?? [];
    const last = msgs.sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    return {
      id: c.id, client_id: client.id, full_name: client.full_name,
      last_message: last?.body ?? "", last_at: last?.created_at ?? "",
      unread: msgs.filter((m) => m.sender_id === client.id && !m.read_at).length,
    };
  });
}

export async function getMessages(conversationId: string): Promise<MessageRow[]> {
  const live = await liveUser();
  if (!live) return [];
  const { supabase, userId } = live;
  const { data, error } = await supabase
    .from("messages")
    .select("id, body, created_at, sender_id")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((m) => ({
    id: m.id, body: m.body, at: m.created_at,
    mine: m.sender_id === userId,
  }));
}

/**
 * Clients a program or plan can be assigned to — the signed-in coach's own.
 *
 * Scoped by coach_id for the same reason as getClients: RLS alone would hand an
 * admin the whole table, and every client it listed that the admin does not
 * coach produced a raw "new row violates row-level security policy" on create.
 */
export async function getRoster(): Promise<{ id: string; name: string }[]> {
  const live = await liveUser();
  if (!live) return [];
  const { supabase, userId } = live;
  const { data, error } = await supabase
    .from("trainer_clients")
    .select("client:users!trainer_clients_client_id_fkey(id, full_name)")
    .eq("coach_id", userId)
    .eq("status", "active");
  if (error) throw error;
  return (data ?? [])
    .map((row) => row.client as unknown as { id: string; full_name: string })
    .filter(Boolean)
    .map((c) => ({ id: c.id, name: c.full_name }));
}


export async function getNutritionPlan(id: string): Promise<NutritionPlanDetail | null> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("nutrition_plans")
    .select(`id, name, status, kcal_target, protein_target_g, carbs_target_g, fat_target_g,
      client:users!nutrition_plans_client_id_fkey(full_name),
      planned_meals(id, slot, name, position, day_index,
        planned_meal_foods(id, grams,
          food:foods(name_ro, name_en, kcal_100g, protein_100g, carbs_100g, fat_100g)))`)
    .eq("id", id)
    .single();
  if (error) return null;

  type FoodJoin = {
    id: string; grams: number;
    food: { name_ro: string | null; name_en: string; kcal_100g: number;
      protein_100g: number; carbs_100g: number; fat_100g: number } | null;
  };
  type MealJoin = { id: string; slot: PlanSlot; name: string; position: number; day_index: number; planned_meal_foods: FoodJoin[] };

  const meals = (data.planned_meals as unknown as MealJoin[])
    .sort((a, b) => a.position - b.position)
    .map((meal) => {
      const foods = meal.planned_meal_foods.map((row) => ({
        id: row.id,
        food_name: row.food?.name_ro ?? row.food?.name_en ?? "—",
        grams: row.grams,
        macros: portionMacros(
          {
            kcal: row.food?.kcal_100g ?? 0, protein: row.food?.protein_100g ?? 0,
            carbs: row.food?.carbs_100g ?? 0, fat: row.food?.fat_100g ?? 0,
          },
          row.grams,
        ),
      }));
      return {
        id: meal.id, slot: meal.slot, name: meal.name, day_index: meal.day_index,
        foods, totals: sumMacros(foods.map((f) => f.macros)),
      };
    });

  return {
    id: data.id, name: data.name, status: data.status,
    client_name: (data.client as unknown as { full_name: string })?.full_name ?? "—",
    kcal_target: data.kcal_target, protein_target_g: data.protein_target_g,
    carbs_target_g: data.carbs_target_g, fat_target_g: data.fat_target_g,
    meals, totals: sumMacros(meals.map((m) => m.totals)),
  };
}

type PlanSlot = "breakfast" | "lunch" | "dinner" | "snack";

