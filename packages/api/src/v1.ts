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

// ---------- food, habits, progress, check-in (Phase 3) ----------

export type MealSlotV1 = "breakfast" | "lunch" | "dinner" | "snack";
export const MEAL_SLOTS_V1: readonly MealSlotV1[] = ["breakfast", "lunch", "dinner", "snack"];

export type FoodPortionV1 = { label: string; grams: number; note: string };

/** A food the person can log: per 100 g, plus its own servings when it has any. */
export type FoodItemV1 = {
  id: string;
  name_en: string;
  name_ro: string;
  brand: string | null;
  per_100g: MacrosV1;
  portions: FoodPortionV1[];
  /** USDA generic row without a Romanian name yet. */
  english_only: boolean;
};

export type QuickFoodV1 = {
  food_id: string | null;
  name: string;
  per_100g: MacrosV1;
  portions: FoodPortionV1[];
  last_grams: number | null;
  favorite: boolean;
};

export type FoodDayV1 = {
  /** The diary day, on the person's own calendar. */
  day: string;
  /** The person's today, so the app knows which day "today" is. */
  today: string;
  plan_name: string | null;
  plan_owner: "coach" | "self" | null;
  target: MacrosV1;
  totals: MacrosV1;
  entries: { id: string; slot: MealSlotV1; food_name: string; grams: number; macros: MacrosV1 }[];
  /** The plan's meals for this day (mealsForWeekday); "ate as planned" logs one. */
  planned: {
    id: string;
    slot: MealSlotV1;
    name: string;
    extra: boolean;
    foods: { name: string; grams: number; macros: MacrosV1 }[];
  }[];
  quick: { recent: QuickFoodV1[]; favorites: QuickFoodV1[] };
};

export type BarcodeV1 =
  | { ok: true; food: FoodItemV1 }
  | { ok: false; reason: "invalid" | "not_found" | "upstream" | "limit" };

/** POST /api/v1/food/logs — the web's logFood input; `clientId` makes a replay a no-op. */
export type FoodLogV1 = {
  slot: MealSlotV1;
  foodName: string;
  grams: number;
  per100g: MacrosV1;
  foodId: string | null;
  day: string;
  clientId: string;
};

export type HabitV1 = { id: string; name: string; target_per_week: number; done_today: boolean; done_this_week: number };
export type HabitsV1 = { today: string; habits: HabitV1[] };

/** POST /api/v1/habits/done — a state, not a toggle, so it can be delivered twice. */
export type HabitDoneV1 = { habitId: string; day: string; done: boolean };

export type ProgressV1 = {
  weight_unit: "kg" | "lb";
  length_unit: "cm" | "in";
  /** Newest first. */
  measurements: { taken_on: string; weight_kg: number | null; waist_cm: number | null }[];
  prs: { exercise: string; best_kg: number; at: string }[];
};

export type MeasurementV1 = { weightKg: number | null; waistCm: number | null; takenOn?: string };

export type CheckInQuestionV1 = { id: string; prompt: string; kind: "scale" | "number" | "yes_no" | "text" };

export type CheckInV1 = {
  week_start: string;
  submitted: boolean;
  has_coach: boolean;
  last: { week_start: string; weight_kg: number | null; note: string | null; coach_feedback: string | null; reviewed: boolean } | null;
  questions: CheckInQuestionV1[];
  weight_unit: "kg" | "lb";
};

export type CheckInSubmitV1 = {
  weightKg: number | null;
  sleep: number;
  energy: number;
  stress: number;
  hunger: number;
  recovery: number;
  note: string;
  answers: { questionId: string; value: number | boolean | string }[];
};

/** A write's answer with the web's machine-readable code (ALREADY_CHECKED_IN…). */
export type CodedResultV1 = WriteResultV1 & { errorCode?: string };

// ---------- messages, notifications, push (Phase 4) ----------

export type MessageV1 = {
  id: string;
  body: string;
  at: string;
  mine: boolean;
  /** A picture or a voice note: the app shows a placeholder and opens the thread on the web. */
  attachment: "image" | "audio" | null;
};

export type CoachThreadV1 = { conversation_id: string; coach_name: string; messages: MessageV1[] } | { conversation_id: null };

export type SendMessageV1 = { conversationId: string; body: string };

export type NotificationV1 = {
  id: string;
  category: string;
  /** In the reader's language, as the web's bell reads it. */
  headline: string;
  body: string | null;
  created_at: string;
  read: boolean;
  /** The web path it points to, when it points anywhere. */
  href: string | null;
};

export type NotificationsV1 = { items: NotificationV1[]; next_cursor: string | null };

export type PushDeviceV1 = { token: string; platform: "android" | "ios"; build: string | null };
