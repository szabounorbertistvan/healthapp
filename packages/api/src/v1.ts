// The /api/v1 contract between apps/web (route handlers under app/api/v1) and
// the Android app (apps/mobile). Old app builds stay installed for months, so
// this only ever grows: a new field is additive, a breaking change is /api/v2.

import type {
  BodyProgress, ChallengeStatus, PostPayload, PostType, ReactionType, GoalDirection, Leaderboard, LeaderboardMetric, LeaderboardPeriod, LeaderboardScope, GoalMetric, GoalPoint, GoalProgress, GoalSeries, GoalStatus, PeriodBucket, ProgressInsight,
  ProgressRange, RepRecord, RoutineCard, StrengthHighlight, TrainingProgress, ExerciseSessionEntry, ExerciseStats,
  CalendarDay, FitnessScore, FitnessScoreTrend, MilestoneReached, StreakStatus, StreakSummary,
  MealDistribution, NutritionBucket, NutritionDay, NutritionInsight, NutritionPeriod, NutritionProgress,
  ProgressionAnalysis, WeeklyComparison, MeasurementComparison,
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
  /** Who sees the social profile's numbers (SocialPrivacyCard); null when it could not be read. */
  privacy?: {
    stats_visibility: "public" | "followers" | "private";
    fitness_score_visibility: "public" | "followers" | "private";
    fitness_score_public: number | null;
    fitness_score_public_at: string | null;
  } | null;
  /** The home gym and whether its board is opted into (MyGymCard). */
  gym?: { home: GymV1 | null; board: boolean };
};

export type GymV1 = { id: string; name: string; city: string; address: string | null; map_url: string };

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

/** One challenge card as /challenges shows it (challenge_cards — progress computed in SQL). */
export type ChallengeCardV1 = {
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
};

/** GET /api/v1/challenges — every challenge the person can see, and the lifts an exercise challenge can be about. */
export type ChallengesV1 = {
  cards: ChallengeCardV1[];
  exercises?: { id: string; name: string }[];
};

/** GET /api/v1/challenges/[id] — one challenge's page: the card, what it counts, the steps reached, the board. */
export type ChallengeDetailV1 = ChallengeCardV1 & {
  type_hint: string;
  milestones: number[];
  /** The viewer created it — only then is deleting offered. */
  mine: boolean;
  leaderboard: { rank: number; name: string; value: number; me: boolean; completed: boolean }[] | null;
};

/** POST /api/v1/challenges — createChallenge(). */
export type CreateChallengeV1 = {
  name: string;
  description: string;
  type: string;
  targetValue: number;
  startDate: string;
  endDate: string;
  visibility: "public" | "private";
  difficulty: string | null;
  exerciseId: string | null;
};

/** One post as the feed card shows it (FeedPost, slimmed to what the phone draws). */
export type FeedPostV1 = {
  id: string;
  user_id: string;
  author_name: string;
  author_avatar: string | null;
  type: PostType;
  text: string | null;
  payload: PostPayload;
  created_at: string;
  kudos_count: number;
  love_count: number;
  comment_count: number;
  my_reaction: ReactionType | null;
  mine: boolean;
  /** In the reader's own saved posts (/saved); only they can see it. */
  saved: boolean;
  /** Pictures, in order: short-lived links to /api/media (relative to the API's origin). */
  media: { id: string; kind: "image" | "video"; url: string; width: number; height: number }[];
};

export type CommentV1 = {
  id: string;
  parent_id: string | null;
  user_id: string;
  author_name: string;
  author_avatar: string | null;
  body: string;
  created_at: string;
  edited_at: string | null;
  mine: boolean;
};

/** GET /api/v1/feed/[id] — one post and its comments, replies one level under each. */
export type PostDetailV1 = {
  post: FeedPostV1;
  comments: { items: (CommentV1 & { replies: CommentV1[] })[]; next_cursor: string | null };
};

/** GET /api/v1/feed?scope=following|all|mine&before=<cursor> — the home feed (social_feed()). */
export type FeedV1 = { items: FeedPostV1[]; next_cursor: string | null };

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

// ---------- the program builder (own programs) ----------

/** One prescribed exercise as the builder edits it — raw values, not display strings. */
export type BuilderExerciseV1 = {
  id: string;
  exercise: string;
  sets: number;
  reps: string;
  weight_kg: number | null;
  /** RIR for an RIR program (every solo program is), RPE otherwise — what was typed. */
  rpe: number | null;
  rest_seconds: number | null;
  measure: "reps" | "time";
  notes: string | null;
};

/** /builder: the person's own programs and the one open in the builder. */
export type BuilderV1 = {
  /** A client with an active coach does not build programs; nothing else is filled then. */
  coached: boolean;
  programs: { id: string; name: string; status: string; days: number; updated_at: string }[];
  open: {
    id: string;
    name: string;
    status: "draft" | "published" | "archived";
    intensity_mode: "rpe" | "rir" | "simple";
    days: { id: string; name: string; muscle_groups: string[]; exercises: BuilderExerciseV1[] }[];
    /** Whether the next workout comes from it; null when that could not be read. */
    activation: { published: boolean; followed: boolean } | null;
  } | null;
};

/** One match from the exercise library (/exercises/search). */
export type ExerciseHitV1 = {
  id: string;
  name: string;
  equipment: string | null;
  primary_muscles: string[];
  image: string | null;
  mine: boolean;
};

export type ExerciseSearchV1 = { results: ExerciseHitV1[]; total: number };

// ---------- bookings (the client's side) ----------

/** One session the reader booked (my_bookings()), its time already written in the booking's own zone. */
export type BookingV1 = {
  id: string;
  status: "pending" | "confirmed" | "declined" | "cancelled" | "completed" | "no_show";
  coach_name: string;
  coach_avatar: string | null;
  coach_slug: string | null;
  service_name: string;
  start_at: string;
  /** "Tue 4 Nov" and "10:00 – 11:00" in the booking's zone, in the reader's language. */
  date: string;
  time: string;
  /** The zone's short name ("Bucharest"). */
  zone: string;
  price: string | null;
  note: string | null;
  cancellation_reason: string | null;
  cancelled_by_me: boolean;
  conversation_id: string | null;
  /** bookingMoves(): may the reader cancel it now. */
  can_cancel: boolean;
};

export type BookingsV1 = { items: BookingV1[] };

// ---------- routines (the program library) ----------

/** /routines?tab=mine|discover|saved — RoutineCard is the shared card shape, unchanged. */
export type RoutinesV1 = {
  cards: RoutineCard[];
  /** Discover's admin-curated shelf, on its unfiltered first page only. */
  featured: RoutineCard[];
  has_more: boolean;
};

/** /routines/[id] — one routine front to back, and what the reader may do with it. */
export type RoutineDetailV1 = {
  card: RoutineCard;
  intensity_mode: "rpe" | "rir" | "simple";
  /** One session's estimated minutes (sessionMinutes()). */
  session_minutes: number;
  may_copy: boolean;
  /** The reader's own solo program: it opens in the builder. */
  may_edit: boolean;
  days: {
    id: string;
    name: string;
    minutes: number;
    exercises: {
      id: string;
      name: string;
      circuit: number | null;
      sets: number;
      reps: string;
      measure: "reps" | "time";
      rpe: number | null;
      weight_kg: number | null;
      rest_seconds: number | null;
      set_type: string;
      equipment: string | null;
    }[];
  }[];
};

// ---------- gyms ----------

/** One gym in the /gyms list. */
export type GymPinV1 = {
  id: string;
  name: string;
  city: string;
  google_rating: number | null;
  members: number;
  coaches: number;
};

/** GET /api/v1/gyms — the web's /gyms list under the map: the reader's town, best rated first. */
export type GymsV1 = {
  home: GymV1 | null;
  /** The town the list is for, null when it is the overall top. */
  city: string | null;
  items: GymPinV1[];
  /** Every gym in the directory, for the phone's own search. */
  total: number;
};

/** GET /api/v1/gyms/[id] — one gym's page: where, rating, open now, its records, numbers and coaches. */
export type GymDetailV1 = {
  id: string;
  name: string;
  where: string;
  map_url: string;
  rating: number | null;
  ratings_total: number | null;
  open_state: "open" | "closed" | "unknown";
  phone: string | null;
  website: string | null;
  summary: string | null;
  closed_for_good: boolean;
  opening_hours: string[];
  is_home: boolean;
  on_boards: boolean;
  members: number;
  coaches_count: number;
  board: number;
  week: { workouts: number; athletes: number } | null;
  month: { workouts: number; athletes: number; volume_kg: number } | null;
  my_month: number;
  busy_hours: number[] | null;
  busy_days: number[] | null;
  lifts: { exercise_id: string; name: string; lifters: number }[];
  /** The lift, kind and period the records below are for. */
  lift: string | null;
  kind: "e1rm" | "weight";
  period: "all" | "year" | "month";
  records: {
    rank: number;
    user_id: string;
    display_name: string;
    avatar_url: string | null;
    weight_kg: number;
    reps: number;
    achieved_at: string;
    is_me: boolean;
  }[];
  coaches: { id: string; slug: string; display_name: string; avatar_url: string | null; headline: string | null }[];
};

// ---------- one exercise (the library's page) ----------

/** GET /api/v1/exercises/[id] — the exercise and what the reader has done with it (the web's /exercises/[id]). */
export type ExerciseDetailV1 = {
  id: string;
  name: string;
  primary_muscles: string[];
  secondary_muscles: string[];
  facts: { key: "equipment" | "level" | "category" | "mechanic" | "force"; value: string }[];
  image: string | null;
  /** The demo this person sees (their own link, their coach's, the row's) — a YouTube link. */
  video_url: string | null;
  steps: string[];
  stats: ExerciseStats;
  records: RepRecord[];
  /** Newest first; already cut to what the plan's history window shows. */
  sessions: ExerciseSessionEntry[];
  /** More sessions exist than the plan shows. */
  history_cut: boolean;
  charts_locked: boolean;
  truncated: boolean;
  today: string;
};

// ---------- the coach's programs ----------

/** GET /api/v1/coach/programs — the coach's /programs list, and the clients a new one can be for. */
export type CoachProgramsV1 = {
  programs: { id: string; name: string; client_name: string; status: "draft" | "published" | "archived"; days: number; updated_at: string }[];
  roster: { id: string; name: string }[];
};

/** GET /api/v1/coach/programs/[id] — one program in the builder, with whose it is and whether it can still be edited. */
export type CoachProgramV1 = NonNullable<BuilderV1["open"]> & {
  client_name: string;
  /** can_edit_program(): false once that coaching ended or is paused; null when it could not be checked. */
  can_edit: boolean | null;
};

// ---------- the coach's nutrition plans ----------

/** GET /api/v1/coach/nutrition — the coach's /nutrition list, and the clients a new plan can be for. */
export type CoachNutritionV1 = {
  plans: { id: string; name: string; client_name: string; status: "draft" | "published" | "archived"; kcal_target: number; protein_target_g: number; carbs_target_g: number; fat_target_g: number }[];
  roster: { id: string; name: string }[];
};

/** GET /api/v1/coach/nutrition/[id] — one plan as the builder reads it (getNutritionPlan). */
export type CoachPlanV1 = {
  id: string;
  name: string;
  client_name: string;
  status: "draft" | "published" | "archived";
  target: MacrosV1;
  meals: {
    id: string;
    slot: MealSlotV1;
    name: string;
    /** 0 = every day, 1..7 = that ISO weekday only. */
    day_index: number;
    extra: boolean;
    recipe_title: string | null;
    /** The linked recipe's id, null when none or when the reader cannot follow it. */
    recipe_id?: string | null;
    foods: { id: string; food_name: string; grams: number; macros: MacrosV1 }[];
    totals: MacrosV1;
  }[];
  /** Monday..Sunday: what each day's meals add up to. */
  days: MacrosV1[];
  /** can_edit_nutrition_plan(); null when it could not be checked. */
  can_edit: boolean | null;
  /** The coach's plan has foods in meals (Coach Pro, ingredientPlans). */
  foods_allowed: boolean;
  /** The editor's own recipes — the only ones a meal can link (planned_meals_guard). */
  recipes?: { id: string; title: string }[];
};

// ---------- the coach's marketplace overview ----------

/** GET /api/v1/coach/marketplace — the web's /marketplace: the profile's state and completeness, and every count. */
export type CoachMarketplaceV1 = {
  /** No Coach Discovery profile yet: the page invites the coach to make one. */
  has_profile: boolean;
  state: "draft" | "ready" | "pending_review" | "published" | "hidden" | "suspended" | null;
  revision_status: string | null;
  verified: boolean;
  public_url: string | null;
  completeness: { pct: number; items: { key: string; done: boolean; required: boolean; earned: number; weight: number }[] } | null;
  requests: { pending: number; accepted: number };
  bookings: { pending: number; upcoming: number; needs_outcome: number; next: { when: string; client: string; service: string } | null };
  clients: { active: number; invited: number; paused: number };
  messages: { unread: number; conversations_unread: number };
  services: { active: number; bookable: number };
  reviews: { count: number; avg: string | null; latest: { id: string; rating: number; body: string | null; reviewer_name: string }[] };
};

// ---------- one finished workout, with the coach's comments ----------

export type SessionCommentV1 = { id: string; body: string; created_at: string; coach_id: string; mine: boolean };

/** A finished workout set by set (lib/workout-feedback FeedbackSession): the client's own page and the coach's client page. */
export type FeedbackSessionV1 = {
  id: string;
  name: string | null;
  started_at: string;
  completed_at: string | null;
  sets: {
    id: string; set_index: number; exercise: string; reps: number; weight_kg: number | null;
    duration_seconds: number | null; rpe: number | null; rir: number | null; notes: string | null;
    comments: SessionCommentV1[];
  }[];
  comments: SessionCommentV1[];
};

// ---------- streak and fitness score ----------

/** GET /api/v1/streak — the web's /streak: the summary, the 12-week calendar, every milestone. */
export type StreakV1 = {
  today: string;
  timezone: string;
  summary: StreakSummary;
  status: StreakStatus;
  /** The last 12 weeks, Monday → Sunday, oldest week first. */
  calendar: CalendarDay[][];
  milestones: (MilestoneReached & { shared: boolean })[];
  next_milestone: number | null;
  /** STREAK_SHARE_MIN: a milestone from this long can go on the feed. */
  share_min: number;
};

/** GET /api/v1/fitness-score — the web's /fitness-score: both 28-day windows and the trend. */
export type FitnessScoreV1 = {
  current: FitnessScore;
  previous: FitnessScore;
  trend: FitnessScoreTrend;
  today: string;
  /** The plan shows the trend and the breakdown (progressCharts). */
  charts: boolean;
};

// ---------- nutrition trends ----------

/** GET /api/v1/food/trends?range=7|30|90|365|all — the web's /food?view=trends, every number folded on the server. */
export type NutritionTrendsV1 = {
  range: number | null;
  today: { totals: MacrosV1; target: MacrosV1 | null; meals: number };
  progress: NutritionProgress;
  insights: NutritionInsight[];
  series: { unit: "day" | "week" | "month"; items: NutritionBucket[] };
  week: { current: NutritionPeriod; previous: NutritionPeriod };
  plan: { name: string; owner: "coach" | "self"; planned_kcal: number | null; planned_meals: number } | null;
  truncated: boolean;
  /** Null when the bounded entry read did not reach the whole period. */
  meals: MealDistribution | null;
  /** The period's logged days, newest first. */
  days: NutritionDay[];
  today_iso: string;
};

// ---------- my meal plan and my recipes ----------

/** GET /api/v1/food/plan — the web's /food/plan: a coach's plan applies while coached; else the person's own. */
export type MyMealPlanV1 = {
  coached: boolean;
  /** Null: no targets yet, so no plan to fill. */
  solo: { id: string; has_meals: boolean } | null;
  plan: CoachPlanV1 | null;
};

/** One of the person's recipes (lib/recipes-data MyRecipe). */
export type RecipeV1 = {
  id: string;
  title: string;
  servings: number;
  serving_grams: number;
  per_serving: MacrosV1;
  nutrition_source: "dishfinder" | "voinic";
  dishfinder_url: string | null;
  image_url: string | null;
  lines: { label: string; grams: number | null; food_name: string | null }[];
  steps: string[];
  prep_minutes: number | null;
  cook_minutes: number | null;
};

// ---------- the weekly summary ----------

/** GET /api/v1/weekly?week=current|previous — this week against the last (packages/shared compareWeeks), on the person's calendar. */
export type WeeklySummaryV1 = WeeklyComparison & { choice: "current" | "previous" };

// ---------- the coach's page for one client ----------

/** GET /api/v1/coach/clients/[id]?week= — the web's /clients/[id]: everything under RLS, computed by the client's own code. */
export type CoachClientPageV1 = {
  id: string;
  name: string;
  signal: string;
  goal: string | null;
  /** Coach Pro: the signal, the score, the goals, the lift verdicts. */
  analytics: boolean;
  fitness: { current: FitnessScore; previous: FitnessScore; trend: FitnessScoreTrend } | null;
  weekly: WeeklySummaryV1 | null;
  lifts: { id: string; name: string; analysis: ProgressionAnalysis }[] | null;
  /** The client's last finished workouts, set by set, to comment on. */
  workouts: FeedbackSessionV1[];
  /** What the client put on their feed, as a follower sees it. */
  posts: FeedPostV1[];
};

// ---------- progress photos and two weigh-in dates ----------

/** GET /api/v1/progress/body?from=&to= — the Body tab's compare card and photos (the web's /progress?tab=body). */
export type ProgressBodyV1 = {
  /** Every day with a measurement the plan shows, oldest first. */
  days: string[];
  from: string | null;
  to: string | null;
  comparison: MeasurementComparison | null;
  photos: {
    /** Cloudinary is set up on this deployment. */
    configured: boolean;
    /** Side by side is in the plan (photoCompare). */
    compare: boolean;
    /** Signed, short-lived links, newest first. */
    items: { id: string; date: string; pose: "front" | "side" | "back"; url: string }[];
    older_hidden_days: number | null;
  };
};

/** POST /api/v1/photos/ticket — permission to upload one pose straight to Cloudinary (requestPhotoUpload). */
export type PhotoTicketV1 = WriteResultV1 & {
  ticket?: { cloudName: string; apiKey: string; timestamp: number; signature: string; publicId: string; folder: string };
};

// ---------- the coach's bookings and reviews ----------

/** GET /api/v1/coach/bookings?tab= — the web's /bookings: one row per booking, with the moves bookingMoves() allows. */
export type CoachBookingsV1 = {
  tab: "upcoming" | "pending" | "confirmed" | "past" | "completed" | "cancelled";
  items: {
    id: string;
    status: BookingV1["status"];
    person_id: string;
    person_name: string;
    person_avatar: string | null;
    service_name: string;
    start_at: string;
    date: string;
    time: string;
    zone: string;
    price: string | null;
    note: string | null;
    cancellation_reason: string | null;
    cancelled_by_me: boolean;
    conversation_id: string | null;
    moves: ("accept" | "decline" | "cancel" | "complete" | "no_show")[];
  }[];
};

/** GET /api/v1/coach/reviews — the coach's reviews about themselves (coach_my_reviews), null without a profile. */
export type CoachReviewsV1 = {
  count: number;
  average: number | null;
  distribution: number[];
  slug: string;
  items: {
    id: string; rating: number; body: string | null; created_at: string; edited_at: string | null;
    reviewer_name: string; reviewer_avatar: string | null; basis: "coaching" | "booking";
    coach_response: string | null; coach_response_at: string | null; status: "published" | "hidden";
  }[];
} | null;

// ---------- finding a coach (Coach Discovery) ----------

/** One coach card (lib/coach-discovery toCoachCard), in the reader's language. */
export type CoachCardV1 = {
  slug: string;
  name: string;
  avatar_url: string | null;
  headline: string | null;
  verified: boolean;
  city: string | null;
  formats: ("online" | "in_person")[];
  years: number | null;
  specializations: string[];
  more_specializations: number;
  starting_price: string | null;
  accepting: boolean;
  rating: { average: number; count: number } | null;
  profile_id: string | null;
  saved: boolean | null;
  available_soon: boolean;
};

/** GET /api/v1/coaches?q=&online=1&in_person=1&spec=&all=1&page=&saved=1 — search_coaches(), the web's /coaches listing. */
export type CoachSearchV1 = {
  total: number;
  has_more: boolean;
  items: CoachCardV1[];
  /** Specializations that have published coaches, for the filter chips. */
  specializations: { slug: string; name: string; coaches: number }[];
};

/** GET /api/v1/coaches/[slug] — a coach's public page as a signed-in reader sees it. */
export type CoachPageV1 = {
  id: string;
  slug: string;
  name: string;
  avatar_url: string | null;
  cover_url: string | null;
  headline: string | null;
  about: string | null;
  approach: string | null;
  experience_summary: string | null;
  years: number | null;
  coaching_since: number | null;
  accepting: boolean;
  online: boolean;
  in_person: boolean;
  verified: boolean;
  followers: number;
  specializations: string[];
  languages: string[];
  locations: { city: string; country: string; gym: string | null }[];
  certifications: { name: string; issuer: string | null; year: number | null; verified: boolean }[];
  services: {
    id: string; name: string; description: string | null; price: string | null; duration: string | null;
    /** The reader may book it now; else why not (a booking error code), null when it is not bookable at all. */
    book: "ok" | string | null;
  }[];
  next_slot: string | null;
  timezone: string | null;
  /** startCoachingState(): what the contact button says and does. */
  state: "sign_in" | "self" | "client" | "paused" | "pending" | "accepted" | "not_accepting" | "start_new" | "contact_again" | "available" | "preview";
  pending_request_id: string | null;
  has_other_coach: boolean;
  saved: boolean;
  reviews: {
    count: number; average: number | null; distribution: number[];
    items: { id: string; rating: number; body: string | null; created_at: string; reviewer_name: string; reviewer_avatar: string | null; basis: "coaching" | "booking"; coach_response: string | null; is_mine: boolean }[];
  };
  /** The reader's own review of this coach and whether they may write one. */
  my_review: { eligible: boolean; review: { id: string; rating: number; body: string | null; status: "published" | "hidden" } | null } | null;
};

/** GET /api/v1/coaches/slots?service=&from=&days= — free starts for one service (coach_booking_slots). */
export type CoachSlotsV1 = { start_at: string; end_at: string }[];

// ---------- workout import ----------

/** One imported workout as the file reader returns it (lib/import/workout-csv ImportedSession). */
export type ImportSessionV1 = {
  key: string;
  title: string;
  startLocal: string;
  durationMinutes: number | null;
  notes: string | null;
  sets: { ordinal: number; exercise: string; weightKg: number; reps: number; durationSeconds: number | null; rpe: number | null; notes: string | null }[];
};

/** POST /api/v1/import/preview — the file read on the server (lib/import/workout-csv.ts) and each name matched to the library. */
export type ImportPreviewV1 =
  | {
      ok: true;
      format: "hevy" | "strong" | "fitbod" | "fitnotes" | "voinic";
      weight_unit: "kg" | "lb";
      unit_from_file: boolean;
      sessions: ImportSessionV1[];
      skipped: { warmups: number; cardio: number; invalid: number };
      names: { name: string; sets: number; match: string | null; suggestions: { id: string; name: string }[] }[];
    }
  | { ok: false; error: "empty" | "unknownFormat" | "noSessions" | "tooLarge" };

export type ImportChunkResultV1 = WriteResultV1 & { sessions?: number; sets?: number; already?: number; dayTaken?: number; future?: number };

// ---------- reports ----------

/** GET /api/v1/reports/preview?type=&range= | from=&to= — what the period holds (the web's /reports preview). */
export type ReportPreviewV1 =
  | {
      ok: true;
      from: string;
      to: string;
      days: number;
      /** Progress only; a CSV is one table read on download. */
      sections: { key: "training" | "body" | "nutrition" | "goals" | "fitness"; ok: boolean; extra: string | null }[] | null;
      nothing: boolean;
      labels_missing: "failed" | "incomplete" | null;
      /** The plan allows the file (reportExports). */
      can_export: boolean;
      /** The path under /api/v1/reports/file/ to download. */
      file: string;
      file_name: string;
    }
  | { ok: false; code: string; message: string };
