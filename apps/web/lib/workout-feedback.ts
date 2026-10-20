import "server-only";
import { liveUser } from "@/lib/supabase/server";

/**
 * A logged workout with the coach's comments on it and on its sets
 * (20261207110000). One shape for both sides: the coach reads a client's
 * recent workouts (the session/set coach policies, is_active_coach_of), the
 * client reads one of their own. Comments come from coach_feedback, which
 * coach and client may both read (feedback_select).
 */
export type FeedbackComment = { id: string; body: string; created_at: string; coach_id: string; mine: boolean };
export type FeedbackSet = {
  id: string; set_index: number; exercise: string; reps: number; weight_kg: number | null;
  duration_seconds: number | null; rpe: number | null; rir: number | null; notes: string | null;
  comments: FeedbackComment[];
};
export type FeedbackSession = {
  id: string; name: string | null; started_at: string; completed_at: string | null;
  sets: FeedbackSet[];
  comments: FeedbackComment[];
};

type SessionRow = {
  id: string; started_at: string; completed_at: string | null;
  day: { name: string } | null;
  sets: { id: string; set_index: number; reps: number; weight_kg: number | null; duration_seconds: number | null; rpe: number | null; rir: number | null; notes: string | null;
    exercise: { name_en: string; name_ro: string | null } | null }[];
};

const SELECT =
  "id, started_at, completed_at, day:program_days(name), sets:logged_sets(id, set_index, reps, weight_kg, duration_seconds, rpe, rir, notes, exercise:exercises(name_en, name_ro))";

async function attach(rows: SessionRow[], clientId: string, viewer: string, locale: "en" | "ro"): Promise<FeedbackSession[]> {
  const live = await liveUser();
  if (!live || rows.length === 0) return [];
  const refs = rows.flatMap((r) => [r.id, ...r.sets.map((s) => s.id)]);
  const { data: fb } = await live.supabase
    .from("coach_feedback")
    .select("id, body, created_at, coach_id, reference_type, reference_id")
    .eq("client_id", clientId)
    .in("reference_type", ["session", "set"])
    .in("reference_id", refs.slice(0, 400))
    .order("created_at");
  const byRef = new Map<string, FeedbackComment[]>();
  for (const f of fb ?? []) {
    const list = byRef.get(f.reference_id) ?? [];
    list.push({ id: f.id, body: f.body, created_at: f.created_at, coach_id: f.coach_id, mine: f.coach_id === viewer });
    byRef.set(f.reference_id, list);
  }
  return rows.map((r) => ({
    id: r.id,
    name: r.day?.name ?? null,
    started_at: r.started_at,
    completed_at: r.completed_at,
    comments: byRef.get(r.id) ?? [],
    sets: [...r.sets].sort((a, b) => a.set_index - b.set_index).map((s) => ({
      id: s.id, set_index: s.set_index, reps: s.reps,
      weight_kg: s.weight_kg === null ? null : Number(s.weight_kg),
      duration_seconds: s.duration_seconds, rpe: s.rpe === null ? null : Number(s.rpe), rir: s.rir === null ? null : Number(s.rir), notes: s.notes,
      exercise: (locale === "ro" ? s.exercise?.name_ro : null) ?? s.exercise?.name_en ?? "—",
      comments: byRef.get(s.id) ?? [],
    })),
  }));
}

/** A client's last completed workouts, for their coach. Empty when the coach cannot read them. */
export async function getClientRecentWorkouts(clientId: string, locale: "en" | "ro", limit = 6): Promise<FeedbackSession[]> {
  const live = await liveUser();
  if (!live) return [];
  const { data, error } = await live.supabase
    .from("logged_sessions")
    .select(SELECT)
    .eq("user_id", clientId)
    .not("completed_at", "is", null)
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("client recent workouts:", error.message);
    return [];
  }
  return attach((data ?? []) as unknown as SessionRow[], clientId, live.userId, locale);
}

/** One of the signed-in person's own workouts, with the coach's comments. Null when it is not theirs. */
export async function getMyWorkoutWithFeedback(sessionId: string, locale: "en" | "ro"): Promise<FeedbackSession | null> {
  const live = await liveUser();
  if (!live || !/^[0-9a-f-]{36}$/i.test(sessionId)) return null;
  const { data, error } = await live.supabase
    .from("logged_sessions")
    .select(SELECT)
    .eq("id", sessionId)
    .eq("user_id", live.userId)
    .maybeSingle();
  if (error || !data) return null;
  const [one] = await attach([data as unknown as SessionRow], live.userId, live.userId, locale);
  if (one) {
    // reading the comments reads their notices
    await live.supabase.from("coach_feedback").update({ read_at: new Date().toISOString() })
      .eq("client_id", live.userId).is("read_at", null)
      .in("reference_id", [one.id, ...one.sets.map((s) => s.id)]);
  }
  return one ?? null;
}
