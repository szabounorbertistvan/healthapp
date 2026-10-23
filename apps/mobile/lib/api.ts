import {
  API_V1, LOCALE_HEADER, type ApiError, type LogSetV1, type MeV1, type TodayV1, type WorkoutDayV1, type WorkoutsV1,
  type WriteResultV1,
} from "@healthapp/api/v1";
import type { Locale } from "@healthapp/i18n/config";
import { config } from "./config";
import type { SendOutcome } from "./outbox-core";
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
  workouts: () => call<WorkoutsV1>("GET", "/workouts"),
  workoutDay: (dayId: string) => call<WorkoutDayV1>("GET", `/workouts/${encodeURIComponent(dayId)}`),
  finishWorkout: (dayId: string) => call<WriteResultV1>("POST", `/workouts/${encodeURIComponent(dayId)}/finish`, {}),
};

/** One outbox delivery, classified for flushOutbox(): a 5xx is "later", like no signal. */
export async function sendSet(input: LogSetV1): Promise<SendOutcome> {
  try {
    const result = await call<WriteResultV1>("POST", "/sets", input);
    return result.ok ? { kind: "ok", isPr: Boolean(result.is_pr) } : { kind: "refused", message: result.message ?? "" };
  } catch (error) {
    if (error instanceof ApiFailure && error.kind === "unauthorized") return { kind: "unauthorized" };
    return { kind: "offline" };
  }
}
