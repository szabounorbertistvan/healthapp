// The /api/v1 contract between apps/web (route handlers under app/api/v1) and
// the Android app (apps/mobile). Old app builds stay installed for months, so
// this only ever grows: a new field is additive, a breaking change is /api/v2.

export const API_V1 = "/api/v1";

/** The header the app sends its language in; the answer's text follows it. */
export const LOCALE_HEADER = "x-voinic-locale";

export type ApiError = { error: "unauthorized" | "not_found" | "server_error"; message?: string };

export type MeV1 = {
  id: string;
  /** What the app shows for "who is signed in" — the username, never the email. */
  display_name: string;
  /** Null for a Google sign-up that has not finished its profile yet. */
  username: string | null;
  role: "client" | "coach" | "both" | "admin";
  avatar_url: string | null;
  weight_unit: "kg" | "lb";
};

export type MacrosV1 = { kcal: number; protein: number; carbs: number; fat: number };

export type TodayV1 = {
  display_name: string;
  has_coach: boolean;
  adherence: {
    overall: number;
    workout: number;
    nutrition: number;
    habits: number;
    checkin: boolean;
    signal: "on_track" | "needs_attention" | "at_risk";
  };
  streak_days: number;
  sessions: { done: number; planned: number };
  next_workout: {
    day_id: string;
    day_name: string;
    program_name: string;
    exercise_count: number;
    completed: boolean;
  } | null;
  nutrition: { plan_name: string | null; target: MacrosV1; totals: MacrosV1 };
  habits: { id: string; name: string; done_today: boolean; done_this_week: number; target_per_week: number }[];
  check_in: { week_start: string; submitted: boolean };
};

// ---------- training (Phase 2) ----------

export type WorkoutDaySummaryV1 = {
  day_id: string;
  day_name: string;
  exercise_count: number;
  /** A session for this day was finished today. */
  completed: boolean;
  /** Sets were logged today and the session is not finished. */
  in_progress: boolean;
};

export type WorkoutsV1 = {
  programs: {
    program_id: string;
    program_name: string;
    is_own: boolean;
    /** The one program Today and adherence follow. */
    followed: boolean;
    days: WorkoutDaySummaryV1[];
  }[];
  /** The day Today calls "next", when there is one. */
  next_day_id: string | null;
  has_coach: boolean;
};

export type WorkoutExerciseV1 = {
  /** program_exercises.id — what a logged set answers. */
  id: string;
  /** exercises.id; a set cannot be logged without it. */
  exercise_id: string | null;
  name: string;
  sets: number;
  /** As the coach wrote it ("8-10"); seconds when measure is "time". */
  reps: string;
  weight_kg: number | null;
  /** Under the program's own scale (RIR for RIR programs). */
  target_rpe: number | null;
  rest_seconds: number | null;
  position: number;
  circuit: number | null;
  measure: "reps" | "time";
  /** The coach's cue. */
  notes: string | null;
};

export type LoggedSetV1 = {
  program_exercise_id: string | null;
  set_index: number;
  weight_kg: number;
  reps: number;
  duration_seconds: number | null;
  rpe: number | null;
  rir: number | null;
  notes: string | null;
  is_pr: boolean;
  at: string;
};

export type PreviousSetV1 = {
  set_index: number;
  weight_kg: number;
  reps: number;
  duration_seconds: number | null;
  rpe: number | null;
  rir: number | null;
};

export type WorkoutDayV1 = {
  day_id: string;
  day_name: string;
  program_id: string;
  program_name: string;
  intensity_mode: "rpe" | "rir" | "simple";
  exercises: WorkoutExerciseV1[];
  /** Today's sets for this day. */
  logged: LoggedSetV1[];
  completed: boolean;
  /** exercises.id → the last completed session's sets of that lift. */
  previous: Record<string, { at: string; sets: PreviousSetV1[] }>;
  rest: { default_seconds: number; alert: boolean; exercises: Record<string, number> };
  weight_unit: "kg" | "lb";
};

/** POST /api/v1/sets — the web's LogSetInput, as the set logger sends it. */
export type LogSetV1 = {
  dayId: string;
  dayName: string;
  exerciseName: string;
  exerciseId: string;
  programExerciseId: string;
  setIndex: number;
  weightKg: number;
  reps: number;
  rpe: number | null;
  rir?: number | null;
  notes?: string | null;
  durationSeconds?: number | null;
  /** When the set was done (the outbox may send it later). */
  loggedAt: string;
};

/** The answer of a write: `ok: false` with a message the person can act on. */
export type WriteResultV1 = { ok: boolean; message?: string; is_pr?: boolean };
