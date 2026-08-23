// Server-side data access. Demo mode (no NEXT_PUBLIC_SUPABASE_URL) serves
// fixtures; live mode goes through Supabase under RLS.
import "server-only";
import {
  demoCheckIns, demoClients, demoConversations, demoDashboard,
  demoMessages, demoNutritionPlans, demoProgramDetail, demoPrograms,
} from "./demo";
import { isDemo, supabaseServer } from "./supabase/server";
import type {
  CheckInRow, ClientRow, ConversationRow, DashboardRow, MessageRow,
  NutritionPlanRow, ProgramDetail, ProgramRow,
} from "./types";

export { isDemo };

export async function getDashboard(): Promise<DashboardRow[]> {
  if (isDemo) return demoDashboard;
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("coach_dashboard");
  if (error) throw error;
  return data ?? [];
}

export async function getClients(): Promise<ClientRow[]> {
  if (isDemo) return demoClients;
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("trainer_clients")
    .select("status, started_at, client:users!trainer_clients_client_id_fkey(id, full_name)")
    .in("status", ["invited", "active"]);
  if (error) throw error;
  const dash = await getDashboard();
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
    };
  });
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
  if (isDemo) return demoPrograms;
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
  if (isDemo) return id === demoProgramDetail.id ? demoProgramDetail : demoProgramDetail;
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("programs")
    .select(`id, name, status, intensity_mode, weeks,
      client:users!programs_client_id_fkey(full_name),
      program_days(id, name, week_index, day_index,
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
      id: string; name: string;
      program_exercises: {
        id: string; position: number; target_sets: number; target_reps: string;
        target_weight_kg: number | null; target_rpe: number | null; rest_seconds: number | null;
        exercise: { name_en: string; name_ro: string | null };
      }[];
    }[]).map((d) => ({
      id: d.id, name: d.name,
      exercises: d.program_exercises
        .sort((a, b) => a.position - b.position)
        .map((e) => ({
          id: e.id, exercise: e.exercise?.name_ro ?? e.exercise?.name_en ?? "—",
          sets: e.target_sets, reps: e.target_reps,
          weight: e.target_weight_kg ? `${e.target_weight_kg} kg` : "—",
          rpe: e.target_rpe?.toString() ?? "—",
          rest: e.rest_seconds ? `${e.rest_seconds}s` : "—",
        })),
    })),
  };
}

export async function getNutritionPlans(): Promise<NutritionPlanRow[]> {
  if (isDemo) return demoNutritionPlans;
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
