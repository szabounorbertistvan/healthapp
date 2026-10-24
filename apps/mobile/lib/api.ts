import {
  API_V1, LOCALE_HEADER, type ApiError, type BarcodeV1, type CheckInV1, type CodedResultV1, type FoodDayV1, type FoodItemV1,
  type CoachThreadV1, type HabitsV1, type MealSlotV1, type MeasurementV1, type MeV1, type NotificationsV1, type ProgressV1, type ProgressOverviewV1,
  type PushDeviceV1, type TodayV1, type WorkoutDayV1, type WorkoutsV1, type WriteResultV1,
  type AppConfigV1, type CoachCheckInV1, type CoachConversationV1, type CoachDashboardV1, type CoachRequestV1, type ThreadV1,
  type UpdateSetV1, type DashboardV1,
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

export const api = {
  me: () => call<MeV1>("GET", "/me"),
  today: () => call<TodayV1>("GET", "/today"),
  dashboard: () => call<DashboardV1>("GET", "/dashboard"),
  workouts: () => call<WorkoutsV1>("GET", "/workouts"),
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


