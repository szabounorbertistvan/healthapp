"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { APP_NAME } from "@/lib/brand";
import { useI18n } from "@/lib/i18n/client";

// Information notice, not a consent wall: the app sets only strictly-necessary
// cookies (the Supabase auth session), which under GDPR/ePrivacy require notice
// but no opt-in. If analytics or marketing cookies are ever added, this must
// become a real consent banner (accept/reject, and nothing set before consent).
const STORAGE_KEY = "bg-cookie-notice-v1";

export function CookieBanner() {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);

  // Read localStorage only after mount so server and first client render match.
  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setVisible(true);
    } catch {
      // storage unavailable (private mode etc.) — show the notice each visit
      setVisible(true);
    }
  }, []);

  function acknowledge() {
    try {
      localStorage.setItem(STORAGE_KEY, new Date().toISOString());
    } catch {
      // ignore — banner still dismisses for this visit
    }
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div
      role="region"
      aria-label={t.common.cookieBanner.ariaLabel}
      className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-surface p-4 shadow-[0_-4px_16px_rgba(0,0,0,0.08)]"
    >
      <div className="mx-auto flex max-w-4xl flex-col items-start gap-3 sm:flex-row sm:items-center">
        <p className="flex-1 text-sm text-ink-soft">
          {APP_NAME} {t.common.cookieBanner.beforeBold}{" "}
          <b className="text-ink">{t.common.cookieBanner.bold}</b>{" "}
          {t.common.cookieBanner.afterBold}{" "}
          <Link href="/privacy" className="font-semibold text-accent-ink hover:underline">
            {t.common.cookieBanner.privacyPolicy}
          </Link>
        </p>
        <button
          onClick={acknowledge}
          className="shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg hover:opacity-90"
        >
          {t.common.cookieBanner.gotIt}
        </button>
      </div>
    </div>
  );
}
