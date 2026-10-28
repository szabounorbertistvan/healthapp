import Link from "next/link";
import type { Locale } from "@healthapp/i18n/config";
import { LEGAL, parseInline, type LegalPage } from "@healthapp/i18n/legal";
import { CookieSettingsButton } from "@/components/cookie-banner";
import { APP_NAME, CONTACT_EMAIL } from "@/lib/brand";

// /terms and /privacy: the one text in @healthapp/i18n/legal (the app's legal
// screen reads the same), laid out as the pages always were.

const LINK = "font-semibold text-accent-ink hover:underline";

function Inline({ text }: { text: string }) {
  return parseInline(text, { app: APP_NAME, email: CONTACT_EMAIL }).map((s, i) => {
    if (s.href) {
      return s.href.startsWith("/")
        ? <Link key={i} href={s.href} className={LINK}>{s.text}</Link>
        : <a key={i} href={s.href} className={LINK}>{s.text}</a>;
    }
    if (s.bold) return <b key={i} className="text-ink">{s.text}</b>;
    if (s.italic) return <i key={i}>{s.text}</i>;
    if (s.code) return <code key={i}>{s.text}</code>;
    return s.text;
  });
}

export function LegalDocument({ page, locale }: { page: LegalPage; locale: Locale }) {
  const doc = LEGAL[page][locale];
  return (
    <>
      <h1 className="text-3xl font-extrabold tracking-tight">{doc.title}</h1>
      <p className="mt-2 text-sm text-ink-faint">{doc.updated}</p>

      <div className="mt-8 space-y-8 text-[15px] leading-relaxed text-ink-soft">
        {doc.sections.map((s) => (
          <section key={s.h}>
            <h2 className="mb-2 text-lg font-bold text-ink">{s.h}</h2>
            {s.blocks.map((b, i) => {
              const gap = i > 0 ? "mt-2" : undefined;
              if ("cookieSettings" in b) return <CookieSettingsButton key={i} />;
              if ("ul" in b) {
                return (
                  <ul key={i} className={["list-disc space-y-1 pl-5", gap].filter(Boolean).join(" ")}>
                    {b.ul.map((li, j) => <li key={j}><Inline text={li} /></li>)}
                  </ul>
                );
              }
              return <p key={i} className={gap}><Inline text={b.p} /></p>;
            })}
          </section>
        ))}
      </div>
    </>
  );
}
