"use client";
import { commonMessages } from "@/lib/i18n/messages/common";
import { LOCALE_COOKIE, defaultLocale, isLocale } from "@/lib/i18n/config";
import { ErrorReporter } from "@/components/error-reporter";

/**
 * The last boundary: the root layout itself threw, so there is no
 * <I18nProvider> above this, no dictionary in context and no shell — this
 * component replaces <html>. The locale is read straight off the cookie the
 * layout would have read, and the styles are inline because globals.css is
 * loaded by the layout that is not rendering.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const raw = typeof document === "undefined"
    ? null
    : document.cookie.split("; ").find((c) => c.startsWith(`${LOCALE_COOKIE}=`))?.split("=")[1];
  const locale = isLocale(raw) ? raw : defaultLocale;
  const e = commonMessages[locale].errorBoundary;

  return (
    <html lang={locale}>
      <body style={{ margin: 0, background: "#0b0b0c", color: "#f4f4f5", fontFamily: "system-ui, sans-serif" }}>
        <ErrorReporter error={error} />
        <main style={{ maxWidth: 420, margin: "12vh auto", padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>{e.title}</h1>
          <p style={{ marginTop: 10, fontSize: 14, lineHeight: 1.6, color: "#a1a1aa" }}>{e.body}</p>
          {error.digest ? (
            <p style={{ marginTop: 12, fontFamily: "ui-monospace, monospace", fontSize: 11, color: "#71717a" }}>
              {e.reference}: {error.digest}
            </p>
          ) : null}
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: 20, height: 40, padding: "0 18px", border: 0, borderRadius: 16,
              background: "#e7b84b", color: "#1a1a1a", fontWeight: 700, fontSize: 13, cursor: "pointer",
            }}
          >
            {e.retry}
          </button>
        </main>
      </body>
    </html>
  );
}
