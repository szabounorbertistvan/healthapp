"use client";
import Link from "next/link";
import { useI18n } from "@/lib/i18n/client";

export type Consent = { terms: boolean; health: boolean };

/**
 * The two boxes every account ticks before it holds any health data: the Terms
 * and Privacy Policy, and — separately, because GDPR Art. 9 wants it explicit
 * and not bundled — the processing of health data. Used by the sign-up form and
 * by /complete-profile; the record itself is written by the database
 * (20261113110000).
 */
export function ConsentChecks({ value, onChange }: { value: Consent; onChange: (next: Consent) => void }) {
  const { t } = useI18n();
  const [before, rest = ""] = t.login.consentTerms.split("{terms}");
  const [between, after = ""] = rest.split("{privacy}");
  const link = "font-semibold text-ink underline underline-offset-2 hover:text-accent";

  return (
    <div className="space-y-2.5">
      <label className="flex items-start gap-2.5 text-xs leading-relaxed text-ink-soft">
        <input
          type="checkbox" checked={value.terms} onChange={(e) => onChange({ ...value, terms: e.target.checked })}
          className="mt-0.5 size-4 shrink-0 accent-[var(--color-accent)]"
        />
        <span>
          {before}
          <Link href="/terms" target="_blank" className={link}>{t.login.consentTermsLink}</Link>
          {between}
          <Link href="/privacy" target="_blank" className={link}>{t.login.consentPrivacyLink}</Link>
          {after}
        </span>
      </label>
      <label className="flex items-start gap-2.5 text-xs leading-relaxed text-ink-soft">
        <input
          type="checkbox" checked={value.health} onChange={(e) => onChange({ ...value, health: e.target.checked })}
          className="mt-0.5 size-4 shrink-0 accent-[var(--color-accent)]"
        />
        <span>{t.login.consentHealth}</span>
      </label>
    </div>
  );
}

export const consentGiven = (c: Consent) => c.terms && c.health;
