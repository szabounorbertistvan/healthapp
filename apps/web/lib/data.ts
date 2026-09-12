// Server-side data access. Demo mode (no NEXT_PUBLIC_SUPABASE_URL) serves
// fixtures; live mode goes through Supabase under RLS.
import "server-only";
import {
  demoAdminStats, demoCheckIns, demoClients, demoConversations, demoDashboard,
  demoMessages, demoNutritionPlans, demoProfile,
} from "./demo";
import { isDemo, supabaseServer } from "./supabase/server";
import {
  demoClientRows, demoDashboardRows, demoRoster, store,
  type StoredPlan, type StoredProgram,
} from "./demo-store";
import { effectiveTier, portionMacros, sumMacros } from "@healthapp/shared";
import { LOAD_SET_SELECT, loadOf, toLoadSet, type LoadSetJoin } from "./training-load";
import type {
  AdminStats, AdminUserRow, CheckInRow, ClientRow, ConversationRow, DashboardRow,
  MessageRow, NutritionPlanDetail, NutritionPlanRow, Profile, ProgramDetail, ProgramRow,
} from "./types";
import type { Role, Tier } from "./entitlements";

export { isDemo };

export async function getProfile(): Promise<Profile | null> {
  if (isDemo) return demoProfile;
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const [{ data: user }, { data: sub }] = await Promise.all([
    supabase.from("users").select("id, full_name, username, sex, birth_year, role").eq("id", auth.user.id).single(),
    supabase.from("subscriptions")
      .select("tier, status, trial_ends_at, stripe_customer_id")
      .eq("user_id", auth.user.id).maybeSingle(),
  ]);
  if (!user) return null;
  const role = user.role as Role;
  return {
    id: user.id,
    full_name: user.full_name ?? "Coach",
    username: (user.username as string | null) ?? null,
    sex: (user.sex as Profile["sex"]) ?? null,
    birth_year: (user.birth_year as number | null) ?? null,
    role,
    tier: effectiveTier(sub ? { ...sub, tier: sub.tier as Tier } : null, role),
    trial_ends_at: sub?.trial_ends_at ?? null,
    has_stripe: Boolean(sub?.stripe_customer_id),
  };
}

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

export async function getAdminStats(): Promise<AdminStats> {
  if (isDemo) return demoAdminStats;
  const supabase = await supabaseServer();
  const [{ count: total }, { data: roleRows }, { count: rels }, { data: tierRows }, { data: recent }] =
    await Promise.all([
      supabase.from("users").select("id", { count: "exact", head: true }),
      supabase.from("users").select("role"),
      supabase.from("trainer_clients").select("id", { count: "exact", head: true }).eq("status", "active"),
      supabase.from("subscriptions").select("tier").eq("status", "active"),
      supabase.from("users").select(ADMIN_USER_SELECT)
        .order("created_at", { ascending: false }).limit(10),
    ]);
  const roles = roleRows ?? [];
  const tierCounts = new Map<string, number>();
  for (const t of tierRows ?? []) tierCounts.set(t.tier, (tierCounts.get(t.tier) ?? 0) + 1);
  return {
    total_users: total ?? 0,
    coaches: roles.filter((r) => r.role === "coach" || r.role === "both").length,
    clients: roles.filter((r) => r.role === "client" || r.role === "both").length,
    active_relationships: rels ?? 0,
    tiers: [...tierCounts.entries()].map(([tier, count]) => ({ tier: tier as Tier, count })),
    recent_users: (recent ?? []).map(toAdminUserRow),
  };
}

/** Shape of the `users` select shared by the admin list and the admin search. */
const ADMIN_USER_SELECT = "id, full_name, role, created_at, subscriptions(tier)";

type AdminUserSelectRow = {
  id: string;
  full_name: string | null;
  role: string;
  created_at: string;
  subscriptions: unknown;
};

function toAdminUserRow(u: AdminUserSelectRow): AdminUserRow {
  return {
    id: u.id,
    full_name: u.full_name ?? "—",
    role: u.role as Role,
    tier: ((u.subscriptions as { tier: string } | null)?.tier ?? "free") as Tier,
    created_at: u.created_at,
  };
}

/**
 * Admin user lookup by name. `users` has no email column — addresses live in
 * `auth.users`, which RLS does not expose — so name is all we can match on.
 *
 * Visibility is the `users_admin_read` policy, not this function: a non-admin
 * running the same query sees only themselves. The page still checks the role
 * so a non-admin gets redirected rather than an oddly empty table.
 */
export async function searchUsers(query: string): Promise<AdminUserRow[]> {
  // % and _ are LIKE wildcards, and , ( ) " break PostgREST's filter parser.
  // Dropping them keeps the search literal without an escaping dance.
  const needle = query.replace(/[%_,()"\\]/g, " ").trim();
  if (!needle) return [];

  if (isDemo) {
    const lower = needle.toLowerCase();
    return demoAdminStats.recent_users.filter((u) =>
      u.full_name.toLowerCase().includes(lower),
    );
  }

  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("users")
    .select(ADMIN_USER_SELECT)
    .ilike("full_name", `%${needle}%`)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []).map(toAdminUserRow);
}

export async function getDashboard(): Promise<DashboardRow[]> {
  if (isDemo) return demoDashboardRows();
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("coach_dashboard");
  if (error) throw error;
  return data ?? [];
}

export async function getClients(): Promise<ClientRow[]> {
  if (isDemo) return demoClientRows();
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("trainer_clients")
    .select("status, started_at, client:users!trainer_clients_client_id_fkey(id, full_name)")
    .in("status", ["invited", "active"]);
  if (error) throw error;
  const [dash, load] = await Promise.all([getDashboard(), clientLoad7d(supabase)]);
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
  if (isDemo) return demoCheckIns;
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
  if (isDemo) {
    return store().programs.map((p) => ({
      id: p.id, name: p.name, client_name: p.client_name, status: p.status,
      days: p.days.length, updated_at: p.updated_at,
    }));
  }
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
  if (isDemo) {
    const program = store().programs.find((p) => p.id === id);
    return program ? toProgramDetail(program) : null;
  }
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("programs")
    .select(`id, name, status, intensity_mode, weeks,
      client:users!programs_client_id_fkey(full_name),
      program_days(id, name, week_index, day_index, muscle_groups,
        program_exercises(id, position, target_sets, target_reps, target_weight_kg, target_rpe, rest_seconds,
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
        target_weight_kg: number | null; target_rpe: number | null; rest_seconds: number | null;
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
        })),
    })),
  };
}

export async function getNutritionPlans(): Promise<NutritionPlanRow[]> {
  if (isDemo) {
    return store().plans.map((p) => ({
      id: p.id, name: p.name, client_name: p.client_name, status: p.status,
      kcal_target: p.kcal_target, protein_target_g: p.protein_target_g,
      carbs_target_g: p.carbs_target_g, fat_target_g: p.fat_target_g,
    }));
  }
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
  if (isDemo) return demoConversations;
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
  if (isDemo) return demoMessages[conversationId] ?? [];
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("messages")
    .select("id, body, created_at, sender_id")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((m) => ({
    id: m.id, body: m.body, at: m.created_at,
    mine: m.sender_id === auth.user?.id,
  }));
}

/** Clients a program or plan can be assigned to. */
export async function getRoster(): Promise<{ id: string; name: string }[]> {
  if (isDemo) return demoRoster();
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("trainer_clients")
    .select("client:users!trainer_clients_client_id_fkey(id, full_name)")
    .eq("status", "active");
  if (error) throw error;
  return (data ?? [])
    .map((row) => row.client as unknown as { id: string; full_name: string })
    .filter(Boolean)
    .map((c) => ({ id: c.id, name: c.full_name }));
}

/** Store row -> the shape the program screens already render. */
function toProgramDetail(program: StoredProgram): ProgramDetail {
  return {
    id: program.id,
    name: program.name,
    client_name: program.client_name,
    status: program.status,
    intensity_mode: program.intensity_mode,
    week: 1,
    weeks: program.weeks,
    days: program.days.map((day) => ({
      id: day.id,
      name: day.name,
      muscle_groups: day.muscle_groups ?? [],
      exercises: [...day.exercises]
        .sort((a, b) => a.position - b.position)
        .map((e) => ({
          id: e.id,
          exercise: e.exercise_name,
          sets: e.target_sets,
          reps: e.target_reps,
          weight: e.target_weight_kg ? `${e.target_weight_kg} kg` : "—",
          rpe: e.target_rpe?.toString() ?? "—",
          rest: e.rest_seconds ? `${e.rest_seconds}s` : "—",
          weight_kg: e.target_weight_kg,
          rpe_value: e.target_rpe,
          rest_seconds: e.rest_seconds,
        })),
    })),
  };
}

export async function getNutritionPlan(id: string): Promise<NutritionPlanDetail | null> {
  if (isDemo) {
    const plan = store().plans.find((p) => p.id === id);
    return plan ? toPlanDetail(plan) : null;
  }
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("nutrition_plans")
    .select(`id, name, status, kcal_target, protein_target_g, carbs_target_g, fat_target_g,
      client:users!nutrition_plans_client_id_fkey(full_name),
      planned_meals(id, slot, name, position,
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
  type MealJoin = { id: string; slot: PlanSlot; name: string; position: number; planned_meal_foods: FoodJoin[] };

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
      return { id: meal.id, slot: meal.slot, name: meal.name, foods, totals: sumMacros(foods.map((f) => f.macros)) };
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

/**
 * Totals are computed here from per-100g values, never stored — the same
 * functions the client app uses, so both surfaces show one number.
 */
function toPlanDetail(plan: StoredPlan): NutritionPlanDetail {
  const meals = [...plan.meals]
    .sort((a, b) => a.position - b.position)
    .map((meal) => {
      const foods = meal.foods.map((food) => ({
        id: food.id,
        food_name: food.food_name,
        grams: food.grams,
        macros: portionMacros(food.per_100g, food.grams),
      }));
      return { id: meal.id, slot: meal.slot, name: meal.name, foods, totals: sumMacros(foods.map((f) => f.macros)) };
    });

  return {
    id: plan.id, name: plan.name, client_name: plan.client_name, status: plan.status,
    kcal_target: plan.kcal_target, protein_target_g: plan.protein_target_g,
    carbs_target_g: plan.carbs_target_g, fat_target_g: plan.fat_target_g,
    meals, totals: sumMacros(meals.map((m) => m.totals)),
  };
}
