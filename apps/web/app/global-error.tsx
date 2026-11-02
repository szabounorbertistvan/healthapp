"use client";
import { commonMessages } from "@healthapp/i18n/messages/common";
import { LOCALE_COOKIE, defaultLocale, isLocale } from "@/lib/i18n/config";
import { ErrorReporter } from "@/components/error-reporter";

/**
 * The last boundary: the root layout itself threw, so there is no
 * <I18nProvider> above this, no dictionary in context and no shell — this
 * component replaces <html>. The locale is read straight off the cookie the
 * layout would have read, and the styles are its own because globals.css is
 * loaded by the layout that is not rendering: a token block with the brand's
 * dark palette (the same values as globals.css) and the few rules this page needs.
 */
const STYLES = `
:root {
  --color-bg: #0b0b0d;
  --color-ink: #f2efe8;
  --color-ink-soft: #b9b5ab;
  --color-ink-faint: #8c887e;
  --color-accent: #d4a938;
  --color-accent-fg: #0b0b0d;
  --font-sans: system-ui, sans-serif;
  --font-mono: ui-monospace, monospace;
}
html, body { overflow-x: clip; }
body { margin: 0; background: var(--color-bg); color: var(--color-ink); font-family: var(--font-sans); }
.ge-main { max-width: 420px; margin: 12vh auto; padding: 24px; text-align: center; }
.ge-title { font-size: 20px; font-weight: 800; margin: 0; }
.ge-body { margin-top: 10px; font-size: 14px; line-height: 1.6; color: var(--color-ink-soft); }
.ge-ref { margin-top: 12px; font-family: var(--font-mono); font-size: 11px; color: var(--color-ink-faint); }
.ge-retry {
  margin-top: 20px; height: 40px; padding: 0 18px; border: 0; border-radius: 16px;
  background: var(--color-accent); color: var(--color-accent-fg); font-weight: 700; font-size: 13px; cursor: pointer;
}
.ge-retry:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }
`;

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const raw = typeof document === "undefined"
    ? null
    : document.cookie.split("; ").find((c) => c.startsWith(`${LOCALE_COOKIE}=`))?.split("=")[1];
  const locale = isLocale(raw) ? raw : defaultLocale;
  const e = commonMessages[locale].errorBoundary;

  return (
    <html lang={locale}>
      <head>
        <style>{STYLES}</style>
      </head>
      <body>
        <ErrorReporter error={error} />
        <main className="ge-main">
          <h1 className="ge-title">{e.title}</h1>
          <p className="ge-body">{e.body}</p>
          {error.digest ? (
            <p className="ge-ref">
              {e.reference}: {error.digest}
            </p>
          ) : null}
          <button type="button" onClick={reset} className="ge-retry">
            {e.retry}
          </button>
        </main>
      </body>
    </html>
  );
}
