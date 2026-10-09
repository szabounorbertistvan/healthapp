"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { APP_NAME } from "@/lib/brand";
import { useI18n } from "@/lib/i18n/client";
import { ANALYTICS_CONSENT_EVENT, GA_MEASUREMENT_ID } from "@/lib/analytics";
import { readConsent, writeConsent } from "./google-analytics";

// A consent banner, not just a notice: essential cookies (the Supabase auth
// session) need no opt-in, but Google Analytics sets cookies and needs a
// prior yes. Nothing analytics-related loads until "Accept"
// (components/google-analytics.tsx), and "Essential only" is as easy as
// "Accept". The choice can be changed from the privacy page.
export function CookieBanner() {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);

  // Read localStorage only after mount so server and first client render match.
  useEffect(() => {
    if (!GA_MEASUREMENT_ID) return;
    const sync = () => setVisible(readConsent() === null);
    sync();
    window.addEventListener(ANALYTICS_CONSENT_EVENT, sync);
    return () => window.removeEventListener(ANALYTICS_CONSENT_EVENT, sync);
  }, []);

  if (!visible) return null;
  const c = t.common.cookieBanner;

  return (
    <div
      role="region"
      aria-label={c.ariaLabel}
      className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-surface p-4 shadow-[0_-4px_16px_rgba(0,0,0,0.08)]"
    >
      <div className="mx-auto flex max-w-4xl flex-col items-start gap-3 sm:flex-row sm:items-center">
        <p className="flex-1 text-sm text-ink-soft">
          {APP_NAME} {c.beforeBold} <b className="text-ink">{c.bold}</b> {c.afterBold}{" "}
          <Link href="/privacy" className="font-semibold text-accent-ink hover:underline">
            {c.privacyPolicy}
          </Link>
        </p>
        <div className="flex w-full shrink-0 gap-2 sm:w-auto">
          <button
            onClick={() => writeConsent("denied")}
            className="flex-1 rounded-lg border border-line bg-bg px-4 py-2 text-sm font-semibold hover:border-ink-faint sm:flex-none"
          >
            {c.essentialOnly}
          </button>
          <button
            onClick={() => writeConsent("granted")}
            className="flex-1 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg hover:opacity-90 sm:flex-none"
          >
            {c.accept}
          </button>
        </div>
      </div>
    </div>
  );
}

/** "Change cookie settings": forgets the choice so the banner asks again. */
export function CookieSettingsButton() {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={() => writeConsent(null)}
      className="mt-2 font-semibold text-accent-ink hover:underline"
    >
      {t.common.cookieBanner.changeSettings}
    </button>
  );
}
