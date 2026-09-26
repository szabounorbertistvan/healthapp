// The routine library: a PROGRAM is the plan, a WORKOUT is what was lifted.
//
// This module holds the rules both the app and the database apply, so the two
// cannot drift:
//
//   estimateMinutes   mirrors the est_seconds sum in program_card_rows()
//   canSeeProgram     mirrors can_see_program()
//   canCopyProgram    mirrors the guards inside copy_program()
//   routineSnapshot   what a shared program may carry into the feed
//
// The SQL is what actually enforces visibility — a policy cannot be argued
// with — but the UI has to predict the same answer to decide whether to draw
// a button, and a button that promises something the database refuses is worse
// than no button.

import { DEFAULT_TARGETS } from "./program-editing";

export const ROUTINE_LEVELS = ["beginner", "intermediate", "advanced"] as const;
export type RoutineLevel = (typeof ROUTINE_LEVELS)[number];

export const ROUTINE_GOALS = ["strength", "hypertrophy", "fat_loss", "endurance", "general"] as const;
export type RoutineGoal = (typeof ROUTINE_GOALS)[number];

export const ROUTINE_VISIBILITIES = ["private", "followers", "public"] as const;
export type RoutineVisibility = (typeof ROUTINE_VISIBILITIES)[number];

/** How the week is split — programs.training_style. Optional, like level and goal. */
export const TRAINING_STYLES = ["full_body", "upper_lower", "push_pull_legs", "body_part_split", "circuit", "other"] as const;
export type TrainingStyle = (typeof TRAINING_STYLES)[number];

export function isTrainingStyle(x: unknown): x is TrainingStyle {
  return typeof x === "string" && (TRAINING_STYLES as readonly string[]).includes(x);
}

/** Session-length ceilings Discover filters on, in minutes (estimateMinutes per day, averaged). */
export const ROUTINE_MAX_MINUTES = [30, 45, 60, 90] as const;

/** Who a routine comes from, as the library shows it. */
export type RoutineSource = "voinic" | "coach" | "user";

export const ROUTINE_SORTS = ["newest", "most_copied"] as const;
export type RoutineSort = (typeof ROUTINE_SORTS)[number];

export function isRoutineLevel(x: unknown): x is RoutineLevel {
  return typeof x === "string" && (ROUTINE_LEVELS as readonly string[]).includes(x);
}
export function isRoutineGoal(x: unknown): x is RoutineGoal {
  return typeof x === "string" && (ROUTINE_GOALS as readonly string[]).includes(x);
}
export function isRoutineVisibility(x: unknown): x is RoutineVisibility {
  return typeof x === "string" && (ROUTINE_VISIBILITIES as readonly string[]).includes(x);
}
export function isRoutineSort(x: unknown): x is RoutineSort {
  return typeof x === "string" && (ROUTINE_SORTS as readonly string[]).includes(x);
}

/** One row of the library, as program_card_rows() returns it. */
export type RoutineCard = {
  id: string;
  name: string;
  description: string | null;
  level: RoutineLevel | null;
  goal: RoutineGoal | null;
  visibility: RoutineVisibility;
  status: string;
  coach_id: string | null;
  client_id: string;
  source_program_id: string | null;
  author_id: string;
  author_name: string;
  author_username: string | null;
  author_avatar: string | null;
  days: number;
  exercises: number;
  total_sets: number;
  est_minutes: number;
  muscle_groups: string[];
  equipment: string[];
  copy_count: number;
  /** programs.weeks — how long the program runs. */
  weeks: number;
  /** Days in the first week — "days per week" as the card states it. */
  days_per_week: number;
  /** One session's estimated minutes — sessionMinutes() over the days. est_minutes is the whole program. */
  session_minutes: number;
  training_style: TrainingStyle | null;
  /** Admin-set; never self-served (see premium_routines_foundation). */
  featured: boolean;
  source: RoutineSource;
  saved: boolean;
  is_mine: boolean;
  /** A coach wrote this one for the person reading it. */
  assigned_by_coach: boolean;
  created_at: string;
  updated_at: string;
};

// ---------- estimated duration ----------

/**
 * Seconds of work charged to one set before its rest. A deliberate constant,
 * not a measurement: the app has no per-set timing, and pretending otherwise
 * would put a precise-looking number on a guess.
 */
export const SET_WORK_SECONDS = 40;

/**
 * What a set with no prescribed rest is charged. Taken from the builder's own
 * default rather than restated, so the estimate cannot drift from what the
 * builder actually writes. (rest-timer.ts has its own DEFAULT_REST_SECONDS —
 * that one is the countdown's fallback, a different question.)
 */
const REST_FALLBACK_SECONDS = DEFAULT_TARGETS.rest_seconds ?? 90;

/**
 * How long a session of this routine takes, in whole minutes.
 *
 * Must stay identical to the est_seconds sum in program_card_rows(): the card
 * reads the SQL figure and the detail page recomputes it from the days it
 * already has, and the two appearing side by side with different numbers is
 * the bug this shared function exists to prevent.
 */
export function estimateMinutes(
  exercises: readonly { target_sets: number; rest_seconds: number | null }[],
): number {
  const seconds = exercises.reduce(
    (sum, e) => sum + Math.max(0, e.target_sets) * (SET_WORK_SECONDS + (e.rest_seconds ?? REST_FALLBACK_SECONDS)),
    0,
  );
  return Math.floor(seconds / 60);
}

/**
 * A session's length: each day's estimateMinutes(), averaged over the days
 * and rounded. Must stay identical to session_minutes in program_card_rows()
 * (and the Discover length filter), so the card, the filter and the detail
 * page agree. An empty day counts as a 0-minute session.
 */
export function sessionMinutes(
  days: readonly (readonly { target_sets: number; rest_seconds: number | null }[])[],
): number {
  if (days.length === 0) return 0;
  return Math.round(days.reduce((sum, d) => sum + estimateMinutes(d), 0) / days.length);
}

// ---------- naming a copy ----------

/**
 * The name a duplicate opens on. "PPL" → "PPL (copy)", and again → "PPL (copy
 * 2)", so duplicating twice does not leave two rows with the same name.
 *
 * `taken` is whatever names the person already has; the suffix is only a
 * suggestion, and the dialog lets them type over it before anything is written.
 */
export function copyName(name: string, taken: readonly string[] = []): string {
  const base = name.trim() || "Routine";
  const used = new Set(taken.map((n) => n.trim().toLowerCase()));
  const first = `${base} (copy)`;
  if (!used.has(first.toLowerCase())) return first.slice(0, 120);
  for (let n = 2; n < 100; n++) {
    const candidate = `${base} (copy ${n})`;
    if (!used.has(candidate.toLowerCase())) return candidate.slice(0, 120);
  }
  return first.slice(0, 120);
}

// ---------- who may do what ----------

export type RoutineOwner = {
  coach_id: string | null;
  client_id: string;
  visibility: RoutineVisibility;
};

export type RoutineViewer = {
  id: string;
  /** True while a coach relationship is active — a coached client authors nothing. */
  has_active_coach: boolean;
  /** Whether the viewer follows the routine's author. */
  follows_author?: boolean;
};

/** Mirrors can_see_program(). */
export function canSeeProgram(program: RoutineOwner, viewer: RoutineViewer): boolean {
  if (program.coach_id === viewer.id) return true;
  if (program.client_id === viewer.id) return true;
  if (program.visibility === "public") return true;
  if (program.visibility === "followers") return viewer.follows_author === true;
  return false;
}

/**
 * Mirrors the guards inside copy_program() for the "copy to my programs" case.
 * A coached client cannot own programs of their own, so for them the button is
 * not merely disabled — it never appears.
 */
export function canCopyProgram(program: RoutineOwner, viewer: RoutineViewer): boolean {
  if (!canSeeProgram(program, viewer)) return false;
  return !viewer.has_active_coach;
}

/** Mirrors can_edit_program(): its coach, or its solo owner while uncoached. */
export function canEditRoutine(program: RoutineOwner, viewer: RoutineViewer): boolean {
  if (program.coach_id !== null) return program.coach_id === viewer.id;
  return program.client_id === viewer.id && !viewer.has_active_coach;
}

/**
 * Only a routine with no coach may leave private — the constraint
 * programs_shareable_only_solo. A coach's program is written for one named
 * person, so publishing it would publish their prescription.
 */
export function canChangeVisibility(program: RoutineOwner, viewer: RoutineViewer): boolean {
  return program.coach_id === null && program.client_id === viewer.id;
}

// ---------- sharing ----------

/**
 * Everything a program post may carry, and nothing else.
 *
 * What is deliberately absent is the point: no logged weights, no body weight,
 * no measurements, no nutrition, and nothing about the people training it.
 * A program post describes a PLAN. `snapshotProgram` is the only way one is
 * built, so there is one place to audit.
 */
export type ProgramPostPayload = {
  kind: "program";
  /** So the card can link back, and so one program is posted once. */
  program_id: string;
  name: string;
  description: string | null;
  days: number;
  exercises: number;
  level: RoutineLevel | null;
  goal: RoutineGoal | null;
  muscle_groups: string[];
  est_minutes: number;
};

/**
 * A snapshot, not a reference: if the author edits the routine tomorrow, the
 * post keeps saying what it said when it was posted. Every other post type in
 * this app works that way and the feed would be incoherent if one did not.
 */
export function snapshotProgram(card: RoutineCard): ProgramPostPayload {
  return {
    kind: "program",
    program_id: card.id,
    name: card.name,
    description: card.description,
    days: card.days,
    exercises: card.exercises,
    level: card.level,
    goal: card.goal,
    muscle_groups: [...card.muscle_groups],
    est_minutes: card.est_minutes,
  };
}

/** A routine may only be posted when everyone who sees the post could open it. */
export function canShareProgram(card: Pick<RoutineCard, "visibility" | "is_mine" | "days">): boolean {
  return card.is_mine && card.visibility === "public" && card.days > 0;
}

// ---------- discover filters ----------

export type RoutineFilter = {
  q?: string;
  level?: RoutineLevel | null;
  goal?: RoutineGoal | null;
  muscle?: string | null;
  equipment?: string | null;
  sort?: RoutineSort;
  style?: TrainingStyle | null;
  /** Average session no longer than this many minutes. */
  maxMinutes?: number | null;
  /** Only admin-featured routines. */
  featured?: boolean;
};

/** Everything the caller asked for, with anything unrecognised dropped. */
export function normalizeRoutineFilter(raw: Record<string, string | undefined | null>): RoutineFilter {
  const q = raw.q?.trim();
  return {
    q: q ? q.slice(0, 80) : undefined,
    level: isRoutineLevel(raw.level) ? raw.level : null,
    goal: isRoutineGoal(raw.goal) ? raw.goal : null,
    muscle: raw.muscle?.trim() || null,
    equipment: raw.equipment?.trim() || null,
    sort: isRoutineSort(raw.sort) ? raw.sort : "newest",
    style: isTrainingStyle(raw.style) ? raw.style : null,
    maxMinutes: (ROUTINE_MAX_MINUTES as readonly number[]).includes(Number(raw.max)) ? Number(raw.max) : null,
    featured: raw.featured === "1",
  };
}

/** True when any filter is narrowing the shelf — the "clear" button's condition. */
export function isFilterActive(filter: RoutineFilter): boolean {
  return Boolean(
    filter.q || filter.level || filter.goal || filter.muscle || filter.equipment || filter.style || filter.maxMinutes || filter.featured,
  );
}

// ---------- source and featuring ----------

/**
 * Mirrors the source_kind expression in program_card_rows(). "Voinic" is an
 * admin mark on a row (programs.is_official), not a special owner: the schema
 * binds every program to a real account (client_id NOT NULL), so an official
 * routine is one published from an account and marked by an admin.
 */
export function routineSource(p: { official: boolean; coach_id: string | null; author_is_coach: boolean }): RoutineSource {
  if (p.official) return "voinic";
  if (p.coach_id !== null || p.author_is_coach) return "coach";
  return "user";
}

/** Mirrors admin_set_program_flags(): only a public routine may be featured or marked official. */
export function canFeatureProgram(p: { visibility: RoutineVisibility }): boolean {
  return p.visibility === "public";
}

export const ROUTINE_PAGE_SIZE = 20;
