import type { Role, Tier } from "./entitlements";

export type Signal = "on_track" | "needs_attention" | "at_risk";

export type Profile = {
  id: string;
  full_name: string;
  role: Role;
  tier: Tier;
};

export type AdminStats = {
  total_users: number;
  coaches: number;
  clients: number;
  active_relationships: number;
  tiers: { tier: Tier; count: number }[];
  recent_users: { id: string; full_name: string; role: Role; tier: Tier; created_at: string }[];
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
  /** Computed from per-100g values by @buddygym/shared, never stored twice. */
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
