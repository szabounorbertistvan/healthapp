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
