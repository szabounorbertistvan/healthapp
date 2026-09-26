// Routine library reads.
//
// Every list goes through one RPC. A program card carries its day count, its
// exercise count, the muscle groups across every exercise, the author's name
// and whether the reader has saved it — in the app that is four round trips
// per card, and a shelf of twenty cards is eighty. program_card_rows() does it
// once, and my_programs() / discover_programs() wrap it.
//
// The RPCs are security definer, so they re-state the visibility rules rather
// than inherit them: can_see_program() is the gate, and it is the same
// predicate the policies use.
import "server-only";
import { cache } from "react";
import {
  ROUTINE_PAGE_SIZE,
  type RoutineCard,
  type RoutineFilter,
} from "@healthapp/shared";
import { liveUser } from "./supabase/server";

/** Rows come back from PostgREST as the RPC declared them. */
function toCards(data: unknown): RoutineCard[] {
  return ((data ?? []) as RoutineCard[]).map((row) => ({
    ...row,
    muscle_groups: row.muscle_groups ?? [],
    equipment: row.equipment ?? [],
    featured: Boolean(row.featured),
    source: row.source ?? "user",
  }));
}

/**
 * A person's published programs, for their profile: the ids come from
 * social_profile_programs() (visibility and can_see_program already applied),
 * the cards from program_card_rows() — the same shape Discover renders, which
 * re-checks can_see_program on every id. Two round trips, never one per card.
 */
export async function getProfileRoutines(userId: string, limit = 6): Promise<RoutineCard[]> {
  const live = await liveUser();
  if (!live) return [];
  const { data: ids, error } = await live.supabase.rpc("social_profile_programs", { p_user: userId, p_limit: limit });
  if (error) {
    console.error("profile programs failed:", error.message);
    return [];
  }
  const list = ((ids ?? []) as { id: string }[]).map((r) => r.id);
  if (list.length === 0) return [];
  const { data } = await live.supabase.rpc("program_card_rows", { p_ids: list });
  const order = new Map(list.map((id, i) => [id, i]));
  return toCards(data).sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

/** Programs the signed-in person authored, plus any a coach assigned to them. */
export const getMyRoutines = cache(async (): Promise<RoutineCard[]> => {
  const live = await liveUser();
  if (!live) return [];
  const { data, error } = await live.supabase.rpc("my_programs", { p_saved: false });
  if (error) {
    throw new Error(`Failed to load my programs: ${error.message}`);
  }
  return toCards(data);
});

/** The programs they bookmarked — other people's, and their own. */
export const getSavedRoutines = cache(async (): Promise<RoutineCard[]> => {
  const live = await liveUser();
  if (!live) return [];
  const { data, error } = await live.supabase.rpc("my_programs", { p_saved: true });
  if (error) {
    throw new Error(`Failed to load saved programs: ${error.message}`);
  }
  return toCards(data);
});

/**
 * The public shelf, one page at a time.
 *
 * Paging is offset-based because Discover is sorted by two different keys
 * (created_at, copy_count) and a keyset cursor would need a different shape
 * for each. One extra row is fetched to answer "is there a next page?" without
 * a second count query.
 */
export async function getDiscoverRoutines(
  filter: RoutineFilter,
  page = 1,
): Promise<{ cards: RoutineCard[]; hasMore: boolean; page: number }> {
  const live = await liveUser();
  if (!live) return { cards: [], hasMore: false, page: 1 };
  const current = Math.max(1, page);
  const { data, error } = await live.supabase.rpc("discover_programs", {
    p_q: filter.q ?? null,
    p_level: filter.level ?? null,
    p_goal: filter.goal ?? null,
    p_muscle: filter.muscle ?? null,
    p_equipment: filter.equipment ?? null,
    p_sort: filter.sort ?? "newest",
    p_limit: ROUTINE_PAGE_SIZE + 1,
    p_offset: (current - 1) * ROUTINE_PAGE_SIZE,
    p_style: filter.style ?? null,
    p_max_minutes: filter.maxMinutes ?? null,
    p_featured: filter.featured ?? false,
  });
  if (error) {
    throw new Error(`Failed to load Discover: ${error.message}`);
  }
  const rows = toCards(data);
  return { cards: rows.slice(0, ROUTINE_PAGE_SIZE), hasMore: rows.length > ROUTINE_PAGE_SIZE, page: current };
}

/**
 * The Featured shelf: admin-marked public routines, newest first. The same
 * discover_programs() read with its featured filter — no second path, and
 * nothing ranked by an algorithm.
 */
export async function getFeaturedRoutines(limit = 6): Promise<RoutineCard[]> {
  const live = await liveUser();
  if (!live) return [];
  const { data, error } = await live.supabase.rpc("discover_programs", { p_featured: true, p_limit: limit });
  if (error) throw new Error(`Failed to load featured routines: ${error.message}`);
  return toCards(data);
}

export type RoutineDay = {
  id: string;
  name: string;
  week_index: number;
  day_index: number;
  muscle_groups: string[];
  exercises: {
    id: string;
    exercise_id: string;
    name: string;
    position: number;
    circuit: number | null;
    target_sets: number;
    target_reps: string;
    target_weight_kg: number | null;
    target_rpe: number | null;
    rest_seconds: number | null;
    set_type: string;
    notes: string | null;
    equipment: string | null;
    /** False when the library row is gone or unreadable — an orphan prescription. */
    exercise_known: boolean;
  }[];
};

export type RoutineDetail = {
  card: RoutineCard;
  intensity_mode: "rpe" | "rir" | "simple";
  days: RoutineDay[];
};

/**
 * One routine with its whole structure.
 *
 * Two round trips, not one per day: the card (which carries the aggregates and
 * the author) and the days with their exercises embedded. RLS decides whether
 * the days come back at all — a private routine returns nothing here even
 * though the id is valid.
 */
export async function getRoutineDetail(programId: string): Promise<RoutineDetail | null> {
  const live = await liveUser();
  if (!live) return null;
  const { supabase } = live;

  const [{ data: cardRows, error: cardError }, { data: program, error: daysError }] = await Promise.all([
    supabase.rpc("program_card_rows", { p_ids: [programId] }),
    supabase
      .from("programs")
      .select(`intensity_mode,
        program_days(id, name, week_index, day_index, muscle_groups,
          program_exercises(id, exercise_id, position, circuit, target_sets, target_reps,
            target_weight_kg, target_rpe, rest_seconds, set_type, notes,
            exercise:exercises(name_en, name_ro, equipment)))`)
      .eq("id", programId)
      .maybeSingle(),
  ]);
  if (cardError) throw new Error(`Failed to load program ${programId}: ${cardError.message}`);
  if (daysError) throw new Error(`Failed to load program ${programId}: ${daysError.message}`);

  const card = toCards(cardRows)[0];
  if (!card || !program) return null;

  type ExJoin = {
    id: string; exercise_id: string; position: number; circuit: number | null;
    target_sets: number; target_reps: string; target_weight_kg: number | null;
    target_rpe: number | null; rest_seconds: number | null; set_type: string | null; notes: string | null;
    exercise: { name_en: string; name_ro: string | null; equipment: string | null } | null;
  };
  type DayJoin = {
    id: string; name: string; week_index: number; day_index: number;
    muscle_groups: string[] | null; program_exercises: ExJoin[] | null;
  };
  const row = program as unknown as { intensity_mode: "rpe" | "rir" | "simple"; program_days: DayJoin[] | null };

  // PostgREST returns embedded rows in no guaranteed order; the plan is an
  // ordered thing, so both levels are sorted here.
  const days = [...(row.program_days ?? [])]
    .sort((a, b) => a.week_index - b.week_index || a.day_index - b.day_index)
    .map((d) => ({
      id: d.id,
      name: d.name,
      week_index: d.week_index,
      day_index: d.day_index,
      muscle_groups: d.muscle_groups ?? [],
      exercises: [...(d.program_exercises ?? [])]
        .sort((a, b) => a.position - b.position)
        .map((e) => ({
          id: e.id,
          exercise_id: e.exercise_id,
          name: e.exercise?.name_ro ?? e.exercise?.name_en ?? "—",
          position: e.position,
          circuit: e.circuit,
          target_sets: e.target_sets,
          target_reps: e.target_reps,
          target_weight_kg: e.target_weight_kg,
          target_rpe: e.target_rpe,
          rest_seconds: e.rest_seconds,
          set_type: e.set_type ?? "normal",
          notes: e.notes,
          equipment: e.exercise?.equipment ?? null,
          exercise_known: e.exercise !== null,
        })),
    }));

  return { card, intensity_mode: row.intensity_mode, days };
}

export type RoutineUsage = { copies: number; users: number; sessions: number; completed: number; saves: number };

/** Aggregate counts only — how much a routine is trained, never by whom. */
export async function getRoutineUsage(programId: string): Promise<RoutineUsage | null> {
  const live = await liveUser();
  if (!live) return null;
  const { data, error } = await live.supabase.rpc("program_usage", { p_program: programId });
  if (error) return null;
  const row = ((data ?? []) as RoutineUsage[])[0];
  return row ?? null;
}

export type RoutineAssignee = {
  program_id: string;
  client_id: string;
  client_name: string;
  status: string;
  updated_at: string;
};

/**
 * The clients a coach has put this routine on. Named people, so the RPC
 * restricts it to the coach who authored the source — a client opening the
 * same routine sees usage counts, never a roster.
 */
export async function getRoutineAssignees(programId: string): Promise<RoutineAssignee[]> {
  const live = await liveUser();
  if (!live) return [];
  const { data, error } = await live.supabase.rpc("program_assignees", { p_program: programId });
  if (error) return [];
  return (data ?? []) as RoutineAssignee[];
}
