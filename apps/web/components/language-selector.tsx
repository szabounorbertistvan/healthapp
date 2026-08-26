"use client";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useI18n } from "@/lib/i18n/client";
import { locales, LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, type Locale } from "@/lib/i18n";

const SHORT: Record<Locale, string> = { en: "EN", ro: "RO" };

/**
 * EN | RO toggle. The locale lives in a cookie so server components can render
 * the right language; switching just rewrites the cookie and re-renders.
 */
export function LanguageSelector({ className = "" }: { className?: string }) {
  const { locale, t } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function select(next: Locale) {
    if (next === locale) return;
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`;
    startTransition(() => router.refresh());
  }

  return (
    <div
      role="group"
      aria-label={t.common.language.label}
      className={`inline-flex overflow-hidden rounded-lg border border-line text-xs font-semibold ${pending ? "opacity-60" : ""} ${className}`}
    >
      {locales.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => select(l)}
          aria-pressed={l === locale}
          title={t.common.language[l]}
          className={`px-2.5 py-1.5 ${
            l === locale ? "bg-accent text-white" : "bg-surface text-ink-soft hover:text-ink"
          }`}
        >
          {SHORT[l]}
        </button>
      ))}
    </div>
  );
}
