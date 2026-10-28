import type { LegalPage } from "@healthapp/i18n/legal";
import { router } from "expo-router";

// The Terms and the Privacy Policy open in the app's own screen (app/legal/[page].tsx),
// which renders the one text the web's /terms and /privacy render too, so what people
// agree to can never differ between the site and the app.
export function openLegal(page: LegalPage) {
  router.push(`/legal/${page}` as never);
}
