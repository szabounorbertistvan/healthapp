import type { AdherenceResult, Macros } from "@healthapp/shared";
import type { Role, Tier } from "./entitlements";

export type Signal = "on_track" | "needs_attention" | "at_risk";

export type Profile = {
  id: string;
  full_name: string;
  role: Role;
  /** Effective tier — includes an active 30-day trial, not just paid tiers. */
  tier: Tier;
  trial_ends_at: string | null;
  /** True once a Stripe customer exists (shows "Manage billing"). */
  has_stripe: boolean;
};

export type AdminUserRow = {
  id: string;
  full_name: string;
  role: Role;
  tier: Tier;
  created_at: string;
};

export type AdminStats = {
  total_users: number;
  coaches: number;
  clients: number;
  active_relationships: number;
  tiers: { tier: Tier; count: number }[];
  recent_users: AdminUserRow[];
};

export type DashboardRow = {
  client_id: string;
  full_name: string;
  avatar_url: string | null;
  signal: Signal;
  reason: string;
  overall_pct: number;
  last_activity: string | null;
  pending_checkin: boolean;
  unread_messages: number;
};

export type ClientRow = {
  client_id: string;
  full_name: string;
  signal: Signal;
  overall_pct: number;
  last_activity: string | null;
  status: "invited" | "active" | "ended";
  started_at: string | null;
};

export type CheckInRow = {
  id: string;
  client_id: string;
  full_name: string;
  week_start: string;
  weight_kg: number | null;
  sleep: number | null;
  energy: number | null;
  stress: number | null;
  hunger: number | null;
  recovery: number | null;
  note: string | null;
  submitted_at: string;
  coach_reviewed_at: string | null;
  previous: {
    weight_kg: number | null;
    sleep: number | null;
    energy: number | null;
    stress: number | null;
    hunger: number | null;
    recovery: number | null;
  } | null;
  context: string;
};

export type ProgramRow = {
  id: string;
  name: string;
  client_name: string;
  status: "draft" | "published" | "archived";
  days: number;
  updated_at: string;
};

export type ProgramExerciseRow = {
  id: string;
  exercise: string;
  sets: number;
  reps: string;
  // Display strings for the read-only view; the raw values below are what the
  // builder edits and what program_exercises actually stores.
  weight: string;
  rpe: string;
  rest: string;
  weight_kg: number | null;
  rpe_value: number | null;
  rest_seconds: number | null;
};

export type ProgramDetail = {
  id: string;
  name: string;
  client_name: string;
  status: "draft" | "published" | "archived";
  intensity_mode: "rpe" | "rir" | "simple";
  week: number;
  weeks: number;
  days: { id: string; name: string; exercises: ProgramExerciseRow[] }[];
};

export type NutritionPlanRow = {
  id: string;
  name: string;
  client_name: string;
  status: "draft" | "published" | "archived";
  kcal_target: number;
  protein_target_g: number;
  carbs_target_g: number;
  fat_target_g: number;
};

export type PlanFoodRow = {
  id: string;
  food_name: string;
  grams: number;
  /** Computed from per-100g values by @healthapp/shared, never stored twice. */
  macros: { kcal: number; protein: number; carbs: number; fat: number };
};

export type PlanMealRow = {
  id: string;
  slot: "breakfast" | "lunch" | "dinner" | "snack";
  name: string;
  foods: PlanFoodRow[];
  totals: { kcal: number; protein: number; carbs: number; fat: number };
};

export type NutritionPlanDetail = {
  id: string;
  name: string;
  client_name: string;
  status: "draft" | "published" | "archived";
  kcal_target: number;
  protein_target_g: number;
  carbs_target_g: number;
  fat_target_g: number;
  meals: PlanMealRow[];
  totals: { kcal: number; protein: number; carbs: number; fat: number };
};

export type ConversationRow = {
  id: string;
  client_id: string;
  full_name: string;
  last_message: string;
  last_at: string;
  unread: number;
};

export type MessageRow = {
  id: string;
  mine: boolean;
  body: string;
  at: string;
};

// ---------- client (trainee) surface ----------


export type MealSlot = "breakfast" | "lunch" | "dinner" | "snack";

export type LoggedSetRow = {
  id: string;
  exercise: string;
  set_index: number;
  weight_kg: number;
  reps: number;
  rpe: number | null;
  is_pr: boolean;
  at: string;
};

/** One training day as the client sees it: the plan, plus what is already logged. */
export type ClientWorkoutDay = {
  day_id: string;
  day_name: string;
  program_id: string;
  program_name: string;
  intensity_mode: "rpe" | "rir" | "simple";
  exercises: ProgramExerciseRow[];
  logged: LoggedSetRow[];
  session_id: string | null;
  completed: boolean;
};

export type ClientFoodEntry = {
  id: string;
  slot: MealSlot;
  food_name: string;
  grams: number;
  macros: Macros;
};

export type ClientDayNutrition = {
  day: string;
  plan_name: string | null;
  target: Macros;
  totals: Macros;
  entries: ClientFoodEntry[];
};

export type ClientHabitRow = {
  id: string;
  name: string;
  target_per_week: number;
  done_today: boolean;
  done_this_week: number;
};

export type ClientMeasurementRow = {
  id: string;
  taken_on: string;
  weight_kg: number | null;
  waist_cm: number | null;
};

export type ClientPrRow = {
  exercise: string;
  best: number;
  at: string;
};

export type ClientCheckInState = {
  week_start: string;
  submitted: boolean;
  last: {
    week_start: string;
    weight_kg: number | null;
    note: string | null;
    coach_feedback: string | null;
    reviewed: boolean;
  } | null;
};

/** Everything the Today screen needs, in one round trip. */
export type ClientToday = {
  client_id: string;
  full_name: string;
  adherence: AdherenceResult;
  streak_days: number;
  next_workout: ClientWorkoutDay | null;
  sessions_done: number;
  sessions_planned: number;
  nutrition: ClientDayNutrition;
  habits: ClientHabitRow[];
  check_in: ClientCheckInState;
  last_activity: string | null;
  unread_from_coach: number;
};
