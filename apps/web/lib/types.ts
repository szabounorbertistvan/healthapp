export type Signal = "on_track" | "needs_attention" | "at_risk";

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
  weight: string;
  rpe: string;
  rest: string;
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
