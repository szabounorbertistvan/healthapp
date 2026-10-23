import { cookies } from "next/headers";
import { getDictionary, isLocale, defaultLocale, LOCALE_COOKIE, type Locale } from "./index";
import { bearerContext } from "@/lib/supabase/bearer";

export async function getLocale(): Promise<Locale> {
  // The Android app sends its language with each /api/v1 call (lib/supabase/bearer.ts).
  const bearer = bearerContext();
  if (bearer) return bearer.locale;
  const store = await cookies();
  const value = store.get(LOCALE_COOKIE)?.value;
  return isLocale(value) ? value : defaultLocale;
}

/** Server-component entry point: `const { t, locale } = await getI18n();` */
export async function getI18n() {
  const locale = await getLocale();
  return { locale, t: getDictionary(locale) };
}
