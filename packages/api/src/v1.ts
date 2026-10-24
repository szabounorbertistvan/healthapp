// The /api/v1 contract between apps/web (route handlers under app/api/v1) and
// the Android app (apps/mobile). Old app builds stay installed for months, so
// this only ever grows: a new field is additive, a breaking change is /api/v2.

import type {
  BodyProgress, ChallengeStatus, GoalDirection, Leaderboard, LeaderboardMetric, LeaderboardPeriod, LeaderboardScope, GoalMetric, GoalPoint, GoalProgress, GoalSeries, GoalStatus, PeriodBucket, ProgressInsight,
  ProgressRange, StrengthHighlight, TrainingProgress,
} from "@healthapp/shared";

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
  /** Shares 0..1 (packages/shared adherence), not percentages. */
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
  /** What the day trains (exercise-types) — picks the athlete on the card; null shows none. */
  type?: string | null;
  /** The day's exercises as the web's day card lists them. */
  exercises?: { id: string; name: string; sets: number; reps: string; measure: "reps" | "time" }[];
  /** Sets logged today on this day. */
  logged?: number;
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
  /** users.sex — which athlete the day cards show (the web's athleteSex). */
  sex?: "male" | "female" | "other" | null;
  /** Finished sessions, newest first, inside the plan's history window. */
  sessions?: (SessionCardV1 & { ago: string })[];
  /** Older sessions exist that the plan's history window hides. */
  history_capped?: boolean;
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
  /** logged_sets.id — what an edit names. Absent from servers before 2026-10-24. */
  id?: string;
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
  /** What the day trains — the athlete in the header (null: none). */
  type?: string | null;
  /** users.sex, for the athlete (the web's athleteSex). */
  sex?: "male" | "female" | "other" | null;
  /** Past sessions of this day, newest first, inside the plan's history window (the web's WorkoutHistory). */
  history?: WorkoutHistoryV1[];
  /** Older sessions exist that the plan's history window hides. */
  history_capped?: boolean;
};

/** packages/shared TrainingLoad, as the day page's load card shows it. */
export type TrainingLoadV1 = {
  score: number;
  category: "very_light" | "light" | "moderate" | "hard" | "very_hard";
  volume_kg: number;
  sets: number;
  duration_min: number | null;
  intensity: number | null;
  exercises: number;
};

/** One past session of a training day, with its sets per lift. */
export type WorkoutHistoryV1 = {
  id: string;
  at: string;
  /** "today", "3 days ago" — the web's timeAgo in the person's language. */
  ago: string;
  sets: number;
  volume_kg: number;
  prs: number;
  load: TrainingLoadV1;
  exercises: {
    name: string;
    exercise_id: string | null;
    sets: { id: string; set_index: number; weight_kg: number; reps: number; duration_seconds: number | null; rpe: number | null; rir: number | null; notes: string | null; is_pr: boolean }[];
  }[];
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
  /** Days of the shown day's week (Mon–Sun) with anything logged — the week strip's marks. */
  logged_days?: string[];
  /** The day before, per meal that had anything in it — "same as yesterday" on an empty meal. */
  previous_day?: { day: string; slots: Partial<Record<MealSlotV1, { items: number; kcal: number }>> };
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

/**
 * GET /api/v1/progress/overview?range=7|30|90|365|all — what the web's /progress
 * folds on the server for its headline, insights and the Body, Strength and
 * Consistency tabs (packages/shared/progress over the person's own rows). The
 * app only formats, as the web's components/advanced-progress.tsx does.
 */
export type ProgressOverviewV1 = {
  range: ProgressRange;
  /** A previous window exists to compare with. */
  has_previous: boolean;
  /** The session read hit its cap: the figures cover the newest sessions only. */
  truncated: boolean;
  weight_unit: "kg" | "lb";
  length_unit: "cm" | "in";
  /** The plan shows charts (progressCharts); without it the web shows an upgrade hint instead. */
  charts: boolean;
  stats: { current_weight_kg: number | null; sessions: number; total_volume_kg: number; prs: number };
  insights: ProgressInsight[];
  /** exercises.id → name, for insights and highlights. */
  names: Record<string, string>;
  body: BodyProgress;
  /** Inside the plan's history window, newest first. */
  measurements: { id: string; taken_on: string; weight_kg: number | null; waist_cm: number | null }[];
  history_capped: boolean;
  training: TrainingProgress;
  highlights: StrengthHighlight[];
  buckets: { unit: "week" | "month"; items: PeriodBucket[] };
  fitness: { score: number | null; trend: { current: number; previous: number; delta: number } | null } | null;
  /** Best estimated 1RMs, heaviest first (cut to a few without progressCharts). */
  prs: { exercise: string; exercise_id: string | null; best_kg: number; ago: string }[];
  prs_hidden: number;
  this_week: number;
  streak: { current: number; longest: number } | null;
  /** Days in the program followed now; null without one. */
  planned_per_week: number | null;
};

/** The account form's fields (the web's AccountFields, components/account.tsx ProfileForm). */
export type AccountFieldsV1 = {
  fullName: string;
  username: string;
  city: string;
  bio: string;
  timezone: string;
  /** 0 = Sunday … 6 = Saturday. */
  checkInWeekday: number;
  leaderboardVisibility: "public" | "followers" | "private";
  weightUnit: "kg" | "lb";
  lengthUnit: "cm" | "in";
};

/** GET /api/v1/settings — what /account (and the coach's /settings) edits. */
export type SettingsV1 = {
  role: "client" | "coach" | "both" | "admin";
  account: AccountFieldsV1;
  rest: { default_seconds: number; alert: boolean };
  /** users.email_prefs, one switch per category the person sees. */
  email: Record<string, boolean>;
};

/** POST /api/v1/settings/account — the form and what it showed before (only changed fields are written). */
export type SaveAccountV1 = { input: AccountFieldsV1; baseline?: AccountFieldsV1 };

/** One goal as the web's Goals tab shows it (lib/goals-data.ts GoalView); progress folded by packages/shared. */
export type GoalV1 = {
  id: string;
  title: string;
  metric: GoalMetric;
  direction: GoalDirection;
  target_value: number;
  start_value: number | null;
  start_date: string;
  target_date: string | null;
  status: GoalStatus;
  exercise_id: string | null;
  exercise_name: string | null;
  measure_key: string | null;
  achieved_at: string | null;
  closed_at: string | null;
  progress: GoalProgress;
  points: GoalPoint[];
};

export type GoalCurrentV1 = { value: number | null; missing: GoalSeries["missing"] };

/** GET /api/v1/goals — Progress → Goals (GoalDashboard), the person's units and the plan's active-goal limit. */
export type GoalsV1 = {
  today: string;
  main_goal: string | null;
  active: GoalV1[];
  closed: GoalV1[];
  current: {
    body_weight: GoalCurrentV1;
    weekly_workouts: GoalCurrentV1;
    consistency: GoalCurrentV1;
    kcal_on_target: GoalCurrentV1;
    protein_avg: GoalCurrentV1;
    circumference: Record<string, GoalCurrentV1>;
  };
  exercises: { id: string; name: string; current: number | null }[];
  kcal_target: number | null;
  weight_unit: "kg" | "lb";
  length_unit: "cm" | "in";
  /** null = no limit. */
  max_active: number | null;
};

/** POST /api/v1/goals — createGoal(); values in canonical units (kg, cm, per week, %, g). */
export type CreateGoalV1 = {
  metric: string;
  direction: string;
  targetValue: number;
  startValue: number | null;
  targetDate: string | null;
  exerciseId: string | null;
  measureKey: string | null;
  title: string | null;
};

/** GET /api/v1/leaderboard?metric&period&scope — one board (top 10 + the viewer's row), as /leaderboards. */
export type LeaderboardV1 = {
  metric: LeaderboardMetric;
  period: LeaderboardPeriod;
  scope: LeaderboardScope;
  board: Leaderboard;
  /** For the gym scope: whether a home gym is picked and its board opted into. */
  gym: { home: boolean; board: boolean } | null;
};

/** GET /api/v1/achievements — every badge with the person's progress, worded as /achievements words it. */
export type AchievementsV1 = {
  earned: number;
  total: number;
  categories: { key: string; label: string }[];
  rows: {
    slug: string;
    name: string;
    icon: string | null;
    category: string;
    rarity: string;
    rarity_label: string | null;
    requirement: string;
    awarded_at: string | null;
    target: number;
    percent: number;
    progress_line: string;
  }[];
};

/** GET /api/v1/challenges — every challenge the person can see, with their progress (challenge_cards). */
export type ChallengesV1 = {
  cards: {
    id: string;
    title: string;
    description: string | null;
    type: string;
    /** The type's icon key and the uppercase line under the title (challengeSubtitle). */
    subtitle: string;
    unit_label: string;
    target: number;
    start_date: string;
    end_date: string;
    participants: number;
    joined: boolean;
    can_join: boolean;
    completed_at: string | null;
    progress: number;
    pct: number;
    status: ChallengeStatus;
    days_remaining: number;
    is_platform: boolean;
  }[];
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

// ---------- coach on the go (Phase 5) ----------

export type CoachClientV1 = {
  client_id: string;
  name: string;
  signal: "on_track" | "needs_attention" | "at_risk";
  /** 0..1, like TodayV1.adherence.overall. */
  overall: number;
  /** The signal's reason in the reader's language, as the web's dashboard writes it. */
  why: string;
  last_activity: string | null;
  pending_checkin: boolean;
  unread: number;
};

export type CoachDashboardV1 = {
  clients: CoachClientV1[];
  checkins_pending: number;
  requests_pending: number;
  /** Coach Pro (advancedAnalytics): the signal, its reason, the % and the at-risk count; a Starter desk shows none of them. */
  pro?: boolean;
};

export type CheckInScoresV1 = {
  sleep: number | null;
  energy: number | null;
  stress: number | null;
  hunger: number | null;
  recovery: number | null;
};

export type CoachCheckInV1 = {
  id: string;
  client_id: string;
  name: string;
  week_start: string;
  submitted_at: string;
  weight_kg: number | null;
  scores: CheckInScoresV1;
  previous: (CheckInScoresV1 & { weight_kg: number | null }) | null;
  note: string | null;
  answers: { prompt: string; value: string }[];
};

export type ReviewCheckInV1 = { checkInId: string; clientId: string; feedback: string };

export type CoachConversationV1 = {
  id: string;
  client_id: string;
  name: string;
  last_message: string;
  last_at: string;
  unread: number;
  open: boolean;
};

export type ThreadV1 = {
  id: string;
  other_name: string;
  side: "coach" | "client";
  open: boolean;
  messages: MessageV1[];
};

export type CoachRequestV1 = {
  id: string;
  client_name: string;
  service_name: string | null;
  message: string | null;
  goal: string | null;
  created_at: string;
};

export type RespondRequestV1 = { requestId: string; accept: boolean };

// ---------- hardening (Phase 6) ----------

/** GET /api/v1/app-config — public, no token: what an app build needs to know before anything else. */
export type AppConfigV1 = {
  /** A build below this is told to update instead of failing in odd ways (old /api/v1 shapes). */
  min_build: { android: number; ios: number };
  /** Where "Update" sends the person. */
  store_url: { android: string; ios: string };
};

/** POST /api/v1/sets/update — the web's updateLoggedSet(). */
export type UpdateSetV1 = {
  setId: string;
  dayId: string | null;
  weightKg: number;
  reps: number;
  rpe: number | null;
  rir: number | null;
  notes: string | null;
  durationSeconds: number | null;
};

// ---------- the Today dashboard, 1:1 with the web (2026-10-24) ----------

export type SessionCardV1 = {
  id: string;
  day_id: string | null;
  day_name: string;
  at: string;
  sets: number;
  volume_kg: number;
  prs: number;
  duration_min: number | null;
  /** The session's training load (packages/shared training-load): "Load 82 · Hard". */
  load: { score: number; category: "very_light" | "light" | "moderate" | "hard" | "very_hard" };
};

/**
 * GET /api/v1/dashboard — what the web's /today renders (app/(client)/today/page.tsx),
 * from the same reads. Words the web composes on the server (the at-risk line)
 * come composed; everything else is data the app lays out with the same strings.
 */
export type DashboardV1 = {
  /** The person's own calendar day and zone. */
  today: string;
  time_zone: string;
  has_coach: boolean;
  /** Shares 0..1. */
  adherence: { overall: number; workout: number; nutrition: number; habits: number; checkin: boolean; signal: "on_track" | "needs_attention" | "at_risk" };
  sessions: { done: number; planned: number };
  streak_days: number;
  /** The at-risk line, in the reader's language, or null. */
  nudge: string | null;
  /** Days of this week with a workout logged (for the Mon–Sun strip). */
  workout_days: string[];
  load: { this_week: number; delta_pct: number | null; direction: "increased" | "decreased" | "stable" | string };
  fitness: { status: "building" | "active"; score: number | null; band: string | null; completed_workouts: number; min_workouts: number } | null;
  next: {
    day_id: string;
    day_name: string;
    program_name: string;
    is_own: boolean;
    completed: boolean;
    logged: number;
    total_sets: number;
    exercises: { id: string; name: string; sets: number; reps: string; weight: string; measure: "reps" | "time" }[];
  } | null;
  done_today: SessionCardV1 | null;
  recent: SessionCardV1[];
  streak: { current: number; longest: number; active_today: boolean; active_yesterday: boolean } | null;
  nutrition: {
    plan_name: string | null;
    plan_owner: "coach" | "self" | null;
    target: MacrosV1;
    totals: MacrosV1;
    entries: { slot: MealSlotV1; food_name: string; kcal: number }[];
  };
  habits: { id: string; name: string; done_today: boolean }[];
  check_in: { submitted: boolean; coach_feedback: string | null };
  unread_from_coach: number;
  community: { leaderboard_rank: number | null; active_challenges: number };
};
