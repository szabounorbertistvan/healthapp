import { API_V1, LOCALE_HEADER, type ApiError, type MeV1, type TodayV1 } from "@healthapp/api/v1";
import type { Locale } from "@healthapp/i18n/config";
import { config } from "./config";
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

async function get<T>(path: string): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiFailure("unauthorized", "not signed in");

  let response: Response;
  try {
    response = await fetch(`${config.apiUrl}${API_V1}${path}`, {
      headers: { Authorization: `Bearer ${token}`, [LOCALE_HEADER]: currentLocale, Accept: "application/json" },
    });
  } catch (error) {
    throw new ApiFailure("offline", error instanceof Error ? error.message : "network error");
  }
  if (response.status === 401) throw new ApiFailure("unauthorized", "token refused");
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ApiError | null;
    throw new ApiFailure("server", body?.error ?? `HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

export const api = {
  me: () => get<MeV1>("/me"),
  today: () => get<TodayV1>("/today"),
};
