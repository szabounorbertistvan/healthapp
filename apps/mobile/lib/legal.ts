import type { Locale } from "@healthapp/i18n/config";
import * as WebBrowser from "expo-web-browser";
import { config } from "./config";

// The Terms and the Privacy Policy are one document each, kept on the web
// (app/terms, app/privacy) so the text people agree to can never differ
// between the site and the app; the app shows that page in an in-app browser,
// in the app's language (?lang=, read by the web's middleware).
export function openLegal(page: "terms" | "privacy", locale: Locale) {
  void WebBrowser.openBrowserAsync(`${config.webUrl}/${page}?lang=${locale}`);
}
