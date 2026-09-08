"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { isDemo, supabaseBrowser } from "@/lib/supabase/client";
import { Logo } from "@/components/logo";
import { useI18n } from "@/lib/i18n/client";
import { LanguageSelector } from "@/components/language-selector";
import { authErrorKey } from "@/lib/auth-errors";

const MIN_PASSWORD = 8;

const inputClass =
  "w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent";

/**
 * Where the recovery email lands after /auth/callback has turned the link into
 * a session. The user is signed in at this point (that's what the recovery
 * token grants) and only has to choose the new password.
 *
 * No session means the link was expired, reused, or opened cold — say so and
 * point back to the login page rather than showing a form that cannot work.
 */
export default function ResetPasswordPage() {
  const router = useRouter();
  const { t } = useI18n();
  const [ready, setReady] = useState<boolean | null>(null); // null = checking
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [updated, setUpdated] = useState(false);

  useEffect(() => {
    if (isDemo) {
      setReady(true);
      return;
    }
    if (new URLSearchParams(window.location.search).get("error") === "expired") {
      setReady(false);
      return;
    }
    const supabase = supabaseBrowser();
    supabase.auth.getSession().then(({ data }) => setReady(Boolean(data.session)));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < MIN_PASSWORD) return setError(t.login.errPasswordShort);
    if (password !== repeat) return setError(t.login.errPasswordMismatch);
    if (isDemo) {
      setUpdated(true);
      router.push("/dashboard");
      return;
    }
    setBusy(true);
    setError(null);
    const { error } = await supabaseBrowser().auth.updateUser({ password });
    setBusy(false);
    if (error) {
      setError(t.login[authErrorKey(error)]);
      return;
    }
    setUpdated(true);
    // the (coach)/(client) layouts send each role to its own home
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="fixed right-4 top-4 z-20">
        <LanguageSelector />
      </div>
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-6 flex items-center justify-center gap-2">
          <Logo size="md" />
        </Link>

        {ready === null ? (
          <div className="rounded-xl border border-line bg-surface p-5 text-center text-sm text-ink-soft">…</div>
        ) : ready === false ? (
          <div className="space-y-3 rounded-xl border border-line bg-surface p-5">
            <p className="text-base font-bold">{t.login.resetLinkInvalidTitle}</p>
            <p className="text-sm text-ink-soft">{t.login.resetLinkInvalidBody}</p>
            <button
              type="button" onClick={() => router.push("/login")}
              className="w-full rounded-lg bg-accent py-2 text-sm font-semibold text-accent-fg hover:opacity-90"
            >
              {t.login.backToSignIn}
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3 rounded-xl border border-line bg-surface p-5">
            <p className="text-base font-bold">{t.login.setNewPassword}</p>
            <input
              type="password" autoComplete="new-password" required minLength={MIN_PASSWORD} value={password}
              onChange={(e) => setPassword(e.target.value)} placeholder={t.login.newPassword}
              className={inputClass}
            />
            <input
              type="password" autoComplete="new-password" required value={repeat}
              onChange={(e) => setRepeat(e.target.value)} placeholder={t.login.repeatPassword}
              className={inputClass}
            />
            <p className="text-xs text-ink-faint">{t.login.passwordHint}</p>
            {error ? <p className="text-sm text-risk" role="alert">{error}</p> : null}
            {updated ? <p className="text-sm text-accent-ink">{t.login.passwordUpdated}</p> : null}
            <button
              type="submit" disabled={busy || updated}
              className="w-full rounded-lg bg-accent py-2 text-sm font-semibold text-accent-fg hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "…" : t.login.setNewPassword}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
