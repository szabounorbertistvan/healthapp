"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { useI18n } from "@/lib/i18n/client";
import {
  defaultTheme, isTheme, nextTheme, THEME_COOKIE, THEME_COOKIE_MAX_AGE, type Theme,
} from "@/lib/theme";

/**
 * Theme switch. Cycles system → dark → light. Mirrors LanguageSelector: the
 * choice lives in a cookie so the root layout can stamp `data-theme` on <html>
 * at render time. The attribute is also flipped immediately on click so the
 * switch feels instant. "System" removes the attribute and lets the
 * `prefers-color-scheme` media query in globals.css decide.
 */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [theme, setTheme] = useState<Theme>(defaultTheme);

  useEffect(() => {
    const current = document.documentElement.dataset.theme;
    setTheme(isTheme(current) ? current : "system");
  }, []);

  function toggle() {
    const next = nextTheme(theme);
    setTheme(next);
    if (next === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = next;
    document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=${THEME_COOKIE_MAX_AGE}; samesite=lax`;
    startTransition(() => router.refresh());
  }

  const label = t.common.theme[theme];
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-surface text-ink-soft hover:text-ink ${pending ? "opacity-60" : ""} ${className}`}
    >
      {theme === "system" ? (
        // half-filled circle: "follows the device"
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none" />
        </svg>
      ) : theme === "dark" ? (
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      )}
    </button>
  );
}
