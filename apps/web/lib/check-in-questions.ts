import "server-only";
import { liveUser } from "@/lib/supabase/server";

/**
 * Check-in questions a coach writes (20261207120000). Reads only; RLS decides
 * who sees what: the coach their own questions, a client the active ones of
 * their current coach meant for them.
 */
export type CheckInQuestionKind = "scale" | "number" | "yes_no" | "text";
export type CheckInQuestion = { id: string; prompt: string; kind: CheckInQuestionKind; position: number };
export type CoachCheckInQuestion = CheckInQuestion & { active: boolean; client_id: string | null; client_name: string | null };
export type CheckInAnswer = { prompt: string; kind: CheckInQuestionKind; value_num: number | null; value_bool: boolean | null; value_text: string | null };

/** The questions the signed-in client answers this week, in the coach's order. Empty on any failure (the base check-in still works). */
export async function getMyCheckInQuestions(): Promise<CheckInQuestion[]> {
  const live = await liveUser();
  if (!live) return [];
  const { data, error } = await live.supabase
    .from("check_in_questions")
    .select("id, prompt, kind, position, coach_id")
    .eq("active", true)
    .neq("coach_id", live.userId)
    .order("position")
    .order("created_at");
  if (error) {
    if (error.code !== "42P01" && error.code !== "PGRST205") console.error("check-in questions:", error.message);
    return [];
  }
  return (data ?? []).map((q) => ({ id: q.id, prompt: q.prompt, kind: q.kind as CheckInQuestionKind, position: q.position }));
}

/** The coach's own questions, active first, with the client a one-person question is for. */
export async function getMyCoachQuestions(): Promise<CoachCheckInQuestion[]> {
  const live = await liveUser();
  if (!live) return [];
  const { data, error } = await live.supabase
    .from("check_in_questions")
    .select("id, prompt, kind, position, active, client_id, client:users!check_in_questions_client_id_fkey(full_name)")
    .eq("coach_id", live.userId)
    .order("active", { ascending: false })
    .order("position")
    .order("created_at");
  if (error) {
    if (error.code !== "42P01" && error.code !== "PGRST205") console.error("coach check-in questions:", error.message);
    return [];
  }
  return (data ?? []).map((q) => ({
    id: q.id, prompt: q.prompt, kind: q.kind as CheckInQuestionKind, position: q.position, active: q.active,
    client_id: q.client_id, client_name: (q.client as unknown as { full_name: string } | null)?.full_name ?? null,
  }));
}
