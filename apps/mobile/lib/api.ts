import {
  API_V1, LOCALE_HEADER, type ApiError, type BarcodeV1, type CheckInV1, type CodedResultV1, type FoodDayV1, type FoodItemV1,
  type CoachThreadV1, type HabitsV1, type MealSlotV1, type MeasurementV1, type MeV1, type NotificationsV1, type ProgressV1, type ProgressOverviewV1, type SettingsV1, type SaveAccountV1, type GoalsV1, type CreateGoalV1, type LeaderboardV1, type AchievementsV1, type ChallengesV1, type PostDetailV1, type FeedV1, type GymV1, type ChallengeDetailV1, type CreateChallengeV1,
  type PushDeviceV1, type TodayV1, type WorkoutDayV1, type WorkoutsV1, type WriteResultV1,
  type AppConfigV1, type CoachCheckInV1, type CoachConversationV1, type CoachDashboardV1, type CoachRequestV1, type ThreadV1,
  type UpdateSetV1, type DashboardV1, type BuilderV1, type ExerciseSearchV1, type BookingsV1, type RoutinesV1, type RoutineDetailV1, type GymsV1, type GymDetailV1, type ExerciseDetailV1, type CoachProgramsV1, type CoachProgramV1, type CoachNutritionV1, type CoachPlanV1, type CoachMarketplaceV1, type FeedbackSessionV1, type StreakV1, type FitnessScoreV1, type NutritionTrendsV1, type MyMealPlanV1, type RecipeV1, type ReportPreviewV1, type ImportPreviewV1, type ImportChunkResultV1, type CoachClientPageV1, type WeeklySummaryV1, type ProgressBodyV1, type PhotoTicketV1, type CoachBookingsV1, type CoachReviewsV1, type CoachSearchV1, type CoachPageV1, type CoachSlotsV1,
} from "@healthapp/api/v1";
import type { Locale } from "@healthapp/i18n/config";
import { config } from "./config";
import type { OutboxPayload, SendOutcome } from "./outbox-core";
import { supabase } from "./supabase";

/** Why a call failed, in terms a screen can act on. */
export class ApiFailure extends Error {
  constructor(readonly kind: "offline" | "unauthorized" | "server", message: string) {
    super(message);
  }
}

let currentLocale: Locale = "en";
/** Set by the i18n provider, so every answer comes back in the app's language. */
export function setApiLocale(locale: Locale) {
  currentLocale = locale;
}

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiFailure("unauthorized", "not signed in");

  let response: Response;
  try {
    response = await fetch(`${config.apiUrl}${API_V1}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        [LOCALE_HEADER]: currentLocale,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    throw new ApiFailure("offline", error instanceof Error ? error.message : "network error");
  }
  if (response.status === 401) throw new ApiFailure("unauthorized", "token refused");
  // A write's refusal is an answer with a message (WriteResultV1), even on 400.
  if (!response.ok && !(method === "POST" && response.status === 400)) {
    const err = (await response.json().catch(() => null)) as ApiError | null;
    throw new ApiFailure("server", err?.error ?? `HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

/** A file from /api/v1 (a report), as bytes — the same token and language as every call. */
async function download(path: string): Promise<Uint8Array> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiFailure("unauthorized", "not signed in");
  let response: Response;
  try {
    response = await fetch(`${config.apiUrl}${API_V1}${path}`, { headers: { Authorization: `Bearer ${token}`, [LOCALE_HEADER]: currentLocale } });
  } catch (error) {
    throw new ApiFailure("offline", error instanceof Error ? error.message : "network error");
  }
  if (!response.ok) {
    const err = (await response.json().catch(() => null)) as { message?: string; error?: string } | null;
    throw new ApiFailure("server", err?.message ?? err?.error ?? `HTTP ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

export const api = {
  me: () => call<MeV1>("GET", "/me"),
  weekly: (week: string) => call<WeeklySummaryV1 | null>("GET", `/weekly?week=${week}`),
  coachClient: (id: string, week: string) => call<CoachClientPageV1>("GET", `/coach/clients/${encodeURIComponent(id)}?week=${week}`),
  workoutFeedback: (body: Record<string, unknown>) => call<CodedResultV1>("POST", "/coach/workout-feedback", body),
  reportPreview: (query: string) => call<ReportPreviewV1>("GET", `/reports/preview?${query}`),
  reportFile: (file: string) => download(`/reports/file/${file}`),
  importPreview: (csv: string, unit?: string) => call<ImportPreviewV1>("POST", "/import/preview", { csv, unit }),
  importChunk: (sessions: unknown[]) => call<ImportChunkResultV1>("POST", "/import/chunk", { sessions }),
  importFinish: (exerciseIds: string[]) => call<WriteResultV1>("POST", "/import/finish", { exerciseIds }),
  today: () => call<TodayV1>("GET", "/today"),
  dashboard: () => call<DashboardV1>("GET", "/dashboard"),
  workouts: () => call<WorkoutsV1>("GET", "/workouts"),
  coachPrograms: () => call<CoachProgramsV1>("GET", "/coach/programs"),
  coachProgram: (id: string) => call<CoachProgramV1>("GET", `/coach/programs/${encodeURIComponent(id)}`),
  coaches: (query: string) => call<CoachSearchV1>("GET", `/coaches?${query}`),
  coachPage: (slug: string) => call<CoachPageV1>("GET", `/coaches/${encodeURIComponent(slug)}`),
  coachSlots: (service: string, from: string, days: number) => call<CoachSlotsV1>("GET", `/coaches/slots?service=${service}&from=${from}&days=${days}`),
  coachAct: (body: Record<string, unknown>) => call<CodedResultV1 & { id?: string }>("POST", "/coaches/act", body),
  coachBookings: (tab: string) => call<CoachBookingsV1>("GET", `/coach/bookings?tab=${tab}`),
  coachBookingMove: (id: string, move: string, reason: string | null) => call<CodedResultV1>("POST", "/coach/bookings", { id, move, reason }),
  coachReviews: () => call<CoachReviewsV1>("GET", "/coach/reviews"),
  respondReview: (reviewId: string, body: string) => call<CodedResultV1>("POST", "/coach/reviews", { reviewId, body }),
  coachMarketplace: () => call<CoachMarketplaceV1>("GET", "/coach/marketplace"),
  coachNutrition: () => call<CoachNutritionV1>("GET", "/coach/nutrition"),
  coachPlan: (id: string) => call<CoachPlanV1>("GET", `/coach/nutrition/${encodeURIComponent(id)}`),
  coachNutritionWrite: (op: string, body: Record<string, unknown> = {}) => call<WriteResultV1 & { id?: string }>("POST", "/coach/nutrition/write", { op, ...body }),
  builder: (program?: string) => call<BuilderV1>("GET", `/builder${program ? `?program=${encodeURIComponent(program)}` : ""}`),
  /** One builder action by name (app/api/v1/builder): the web runs the same builder-actions. */
  build: (op: string, body: Record<string, unknown> = {}) => call<WriteResultV1 & { id?: string }>("POST", "/builder", { op, ...body }),
  mealPlan: () => call<MyMealPlanV1>("GET", "/food/plan"),
  startMealPlan: () => call<WriteResultV1 & { id?: string }>("POST", "/food/plan/start"),
  recipes: () => call<RecipeV1[]>("GET", "/recipes"),
  recipeWrite: (op: string, body: Record<string, unknown>) => call<WriteResultV1 & { id?: string; errorCode?: string }>("POST", "/recipes/write", { op, ...body }),
  progressBody: (from?: string, to?: string) => call<ProgressBodyV1>("GET", `/progress/body${from && to ? `?from=${from}&to=${to}` : ""}`),
  photos: (op: string, body: Record<string, unknown>) => call<PhotoTicketV1>("POST", "/photos", { op, ...body }),
  saveTargets: (kcal: number, split: { protein: number; carbs: number; fat: number }) => call<WriteResultV1>("POST", "/food/targets", { kcal, split }),
  foodTrends: (range: string) => call<NutritionTrendsV1>("GET", `/food/trends?range=${range}`),
  streak: () => call<StreakV1>("GET", "/streak"),
  shareStreak: (milestone: number, streakStart: string, visibility: string) => call<WriteResultV1>("POST", "/streak/share", { milestone, streakStart, visibility }),
  fitnessScore: () => call<FitnessScoreV1>("GET", "/fitness-score"),
  shareFitnessScore: (visibility: string) => call<WriteResultV1>("POST", "/fitness-score/share", { visibility }),
  session: (id: string) => call<FeedbackSessionV1>("GET", `/sessions/${encodeURIComponent(id)}`),
  exercise: (id: string) => call<ExerciseDetailV1>("GET", `/exercises/${encodeURIComponent(id)}`),
  searchExercises: (q: string, muscle: string, offset = 0) =>
    call<ExerciseSearchV1>("GET", `/exercises/search?${new URLSearchParams({ q, muscle, offset: String(offset) })}`),
  workoutDay: (dayId: string) => call<WorkoutDayV1>("GET", `/workouts/${encodeURIComponent(dayId)}`),
  finishWorkout: (dayId: string) => call<WriteResultV1>("POST", `/workouts/${encodeURIComponent(dayId)}/finish`, {}),
  foodDay: (day?: string) => call<FoodDayV1>("GET", day ? `/food?day=${encodeURIComponent(day)}` : "/food"),
  searchFoods: (q: string) => call<FoodItemV1[]>("GET", `/foods/search?q=${encodeURIComponent(q)}`),
  barcode: (code: string) => call<BarcodeV1>("GET", `/foods/barcode/${encodeURIComponent(code)}`),
  ateAsPlanned: (slot: MealSlotV1, day: string, mealId?: string) => call<WriteResultV1>("POST", "/food/planned", { slot, day, mealId }),
  deleteFoodLog: (id: string) => call<WriteResultV1>("POST", "/food/logs/delete", { id }),
  updateFoodLog: (id: string, grams: number) => call<WriteResultV1>("POST", "/food/logs/update", { id, grams }),
  copyMeal: (slot: MealSlotV1, from: string, to: string) => call<CodedResultV1>("POST", "/food/copy", { slot, from, to }),
  habits: () => call<HabitsV1>("GET", "/habits"),
  settings: () => call<SettingsV1>("GET", "/settings"),
  exportData: () => call<{ filename: string; json: string }>("GET", "/account/export"),
  deleteAccount: (confirm: string) => call<WriteResultV1 & { purgeAfter?: string }>("POST", "/account/delete", { confirm }),
  goals: () => call<GoalsV1>("GET", "/goals"),
  leaderboard: (metric: string, period: string, scope: string) =>
    call<LeaderboardV1>("GET", `/leaderboard?metric=${encodeURIComponent(metric)}&period=${encodeURIComponent(period)}&scope=${encodeURIComponent(scope)}`),
  achievements: () => call<AchievementsV1>("GET", "/achievements"),
  challenges: () => call<ChallengesV1>("GET", "/challenges"),
  feed: (scope: string, before?: string) =>
    call<FeedV1>("GET", `/feed?scope=${encodeURIComponent(scope)}${before ? `&before=${encodeURIComponent(before)}` : ""}`),
  react: (postId: string, type: "kudos" | "love") => call<WriteResultV1>("POST", "/feed/react", { postId, type }),
  routines: (tab: string, q = "", page = 1) => call<RoutinesV1>("GET", `/routines?${new URLSearchParams({ tab, q, page: String(page) })}`),
  routine: (id: string) => call<RoutineDetailV1>("GET", `/routines/${encodeURIComponent(id)}`),
  copyRoutine: (id: string, name: string) => call<WriteResultV1 & { id?: string }>("POST", "/routines/copy", { id, name }),
  saveRoutine: (id: string, saved: boolean) => call<WriteResultV1 & { saved?: boolean }>("POST", "/routines/save", { id, saved }),
  bookings: () => call<BookingsV1>("GET", "/bookings"),
  cancelBooking: (id: string, reason: string | null) => call<CodedResultV1>("POST", "/bookings/cancel", { id, reason }),
  savedPosts: (before?: string) => call<FeedV1>("GET", `/feed/saved${before ? `?before=${encodeURIComponent(before)}` : ""}`),
  savePost: (postId: string, save: boolean) => call<WriteResultV1>("POST", "/feed/save", { postId, save }),
  createPost: (text: string, visibility: string) => call<WriteResultV1 & { postId?: string }>("POST", "/feed", { text, visibility }),
  post: (id: string, before?: string) =>
    call<PostDetailV1>("GET", `/feed/${encodeURIComponent(id)}${before ? `?before=${encodeURIComponent(before)}` : ""}`),
  addComment: (postId: string, body: string, parentId: string | null) => call<WriteResultV1 & { id?: string }>("POST", "/feed/comment", { postId, body, parentId }),
  deleteComment: (commentId: string, postId: string) => call<WriteResultV1>("POST", "/feed/comment/delete", { commentId, postId }),
  deletePost: (postId: string) => call<WriteResultV1>("POST", "/feed/delete", { postId }),
  challenge: (id: string) => call<ChallengeDetailV1>("GET", `/challenges/${encodeURIComponent(id)}`),
  createChallenge: (body: CreateChallengeV1) => call<WriteResultV1 & { id?: string }>("POST", "/challenges", body),
  deleteChallenge: (id: string) => call<WriteResultV1>("POST", "/challenges/delete", { id }),
  joinChallenge: (id: string) => call<WriteResultV1>("POST", "/challenges/join", { id }),
  leaveChallenge: (id: string) => call<WriteResultV1>("POST", "/challenges/leave", { id }),
  createGoal: (body: CreateGoalV1) => call<CodedResultV1>("POST", "/goals", body),
  updateGoal: (body: { goalId: string; title: string; targetValue: number; targetDate: string | null }) => call<CodedResultV1>("POST", "/goals/update", body),
  closeGoal: (goalId: string, outcome: "achieved" | "abandoned") => call<CodedResultV1>("POST", "/goals/close", { goalId, outcome }),
  deleteGoal: (goalId: string) => call<CodedResultV1>("POST", "/goals/delete", { goalId }),
  saveAccount: (body: SaveAccountV1) => call<CodedResultV1>("POST", "/settings/account", body),
  saveRest: (body: { default_seconds: number; alert: boolean }) => call<WriteResultV1>("POST", "/settings/rest", body),
  saveEmailPref: (category: string, on: boolean) => call<WriteResultV1>("POST", "/settings/email", { category, on }),
  savePrivacy: (stats: string, fitnessScore: string) => call<WriteResultV1>("POST", "/settings/privacy", { stats, fitnessScore }),
  publishScore: () => call<WriteResultV1>("POST", "/settings/publish-score"),
  saveGym: (gymId: string | null, board: boolean) => call<CodedResultV1>("POST", "/settings/gym", { gymId, board }),
  gyms: () => call<GymsV1>("GET", "/gyms"),
  gym: (id: string, board: { lift?: string; kind?: string; period?: string } = {}) => {
    const q = new URLSearchParams(Object.entries(board).filter((e): e is [string, string] => typeof e[1] === "string")).toString();
    return call<GymDetailV1>("GET", `/gyms/${encodeURIComponent(id)}${q ? `?${q}` : ""}`);
  },
  searchGyms: (q: string) => call<(GymV1 & { members: number; coaches: number })[]>("GET", `/gyms/search?q=${encodeURIComponent(q)}`),
  addHabit: (name: string, targetPerWeek: number) => call<WriteResultV1>("POST", "/habits/add", { name, targetPerWeek }),
  archiveHabit: (habitId: string) => call<WriteResultV1>("POST", "/habits/archive", { habitId }),
  progress: () => call<ProgressV1>("GET", "/progress"),
  progressOverview: (range: string) => call<ProgressOverviewV1>("GET", `/progress/overview?range=${encodeURIComponent(range)}`),
  addMeasurement: (m: MeasurementV1) => call<WriteResultV1>("POST", "/measurements", m),
  checkIn: () => call<CheckInV1>("GET", "/check-in"),
  coachThread: () => call<CoachThreadV1>("GET", "/coach-thread"),
  sendMessage: (conversationId: string, body: string) => call<CodedResultV1>("POST", "/messages", { conversationId, body }),
  markThreadRead: (conversationId: string) => call<WriteResultV1>("POST", "/messages/read", { conversationId }),
  notifications: (before?: string) =>
    call<NotificationsV1>("GET", before ? `/notifications?before=${encodeURIComponent(before)}` : "/notifications"),
  markNotificationRead: (id?: string) => call<WriteResultV1>("POST", "/notifications/read", id ? { id } : {}),
  registerPush: (device: PushDeviceV1) => call<WriteResultV1>("POST", "/push-devices", device),
  unregisterPush: (token: string) => call<WriteResultV1>("POST", "/push-devices/remove", { token }),
  updateSet: (edit: UpdateSetV1) => call<WriteResultV1>("POST", "/sets/update", edit),
  thread: (id: string) => call<ThreadV1>("GET", `/threads/${encodeURIComponent(id)}`),
  coachDashboard: () => call<CoachDashboardV1>("GET", "/coach/dashboard"),
  coachCheckIns: () => call<CoachCheckInV1[]>("GET", "/coach/check-ins"),
  reviewCheckIn: (checkInId: string, clientId: string, feedback: string) =>
    call<WriteResultV1>("POST", "/coach/check-ins/review", { checkInId, clientId, feedback }),
  coachConversations: () => call<CoachConversationV1[]>("GET", "/coach/conversations"),
  coachRequests: () => call<CoachRequestV1[]>("GET", "/coach/requests"),
  respondRequest: (requestId: string, accept: boolean) => call<WriteResultV1>("POST", "/coach/requests/respond", { requestId, accept }),
};

/** The one call made without a token: version minimums, before sign-in. Null when unreachable. */
export async function fetchAppConfig(): Promise<AppConfigV1 | null> {
  try {
    const response = await fetch(`${config.apiUrl}${API_V1}/app-config`, { headers: { Accept: "application/json" } });
    return response.ok ? ((await response.json()) as AppConfigV1) : null;
  } catch {
    return null;
  }
}

const PATHS: Record<OutboxPayload["kind"], string> = {
  set: "/sets",
  food: "/food/logs",
  habit: "/habits/done",
  checkin: "/check-in",
};

/**
 * One outbox delivery, classified for flushOutbox(): a 5xx is "later", like no
 * signal. A check-in the server already has counts as delivered — the web's
 * replay rule (lib/offline/sync.tsx).
 */
export async function sendItem(payload: OutboxPayload): Promise<SendOutcome> {
  try {
    const result = await call<CodedResultV1>("POST", PATHS[payload.kind], payload.input);
    if (result.ok || result.errorCode === "ALREADY_CHECKED_IN") return { kind: "ok", isPr: Boolean(result.is_pr) };
    return { kind: "refused", message: result.message ?? "" };
  } catch (error) {
    if (error instanceof ApiFailure && error.kind === "unauthorized") return { kind: "unauthorized" };
    return { kind: "offline" };
  }
}


