import { cookies } from "next/headers";
import { defaultTheme, isTheme, THEME_COOKIE, type Theme } from "./theme";

/** Server-only: read the theme cookie. Default is dark (the brand). */
export async function getTheme(): Promise<Theme> {
  const raw = (await cookies()).get(THEME_COOKIE)?.value;
  return isTheme(raw) ? raw : defaultTheme;
}
