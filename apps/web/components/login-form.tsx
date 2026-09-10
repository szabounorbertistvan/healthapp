"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { isDemo, supabaseBrowser, enabledOAuthProviders } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n/client";
import { authErrorKey } from "@/lib/auth-errors";
import { usernameAvailable } from "@/app/profile-actions";
import { birthYearFromAge, isValidAge, isValidUsername, SEXES } from "@/lib/profile";
import type { Sex } from "@/lib/types";

export type LoginMode = "signin" | "signup" | "forgot";
type Role = "coach" | "client";
type Done = { kind: "confirm" | "reset"; email: string } | null;

const MIN_PASSWORD = 8;

const inputClass =
  "w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent";

/**
 * The sign-in / sign-up / forgot-password form. Rendered full-page at /login
 * (the destination of email links, OAuth callbacks and the middleware) and
 * inside the LoginModal on the landing page. All auth logic lives here so the
 * two never drift.
 */
export function LoginForm({ initialMode = "signin" }: { initialMode?: LoginMode }) {
  const router = useRouter();
  const { t } = useI18n();
  const [mode, setMode] = useState<LoginMode>(initialMode);
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [sex, setSex] = useState<Sex | "">("");
  const [age, setAge] = useState("");
  const [role, setRole] = useState<Role>("client");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Done>(null);
  // shown only once the Supabase project has the provider switched on
  const [googleEnabled, setGoogleEnabled] = useState(isDemo);

  useEffect(() => {
    if (isDemo) return;
    let cancelled = false;
    enabledOAuthProviders().then((providers) => {
      if (!cancelled) setGoogleEnabled(providers.has("google"));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // /auth/callback sends an expired email link or a failed Google round-trip back here
  useEffect(() => {
    const reason = new URLSearchParams(window.location.search).get("error");
    if (reason === "link") setError(t.login.resetLinkInvalidTitle);
    else if (reason === "oauth") setError(t.login.errOAuth);
    if (reason) window.history.replaceState(null, "", window.location.pathname);
  }, [t]);

  function switchMode(next: LoginMode) {
    setMode(next);
    setError(null);
    setDone(null);
    setPassword("");
    setRepeat("");
  }

  // client-side checks, before anything is sent
  function validate(): string | null {
    if (mode === "forgot") return null;
    if (mode === "signup" && fullName.trim().length === 0) return t.login.errNameRequired;
    if (mode === "signup" && !isValidUsername(username)) return t.login.errUsernameFormat;
    if (mode === "signup" && !sex) return t.login.errSexRequired;
    if (mode === "signup" && !isValidAge(parseInt(age, 10))) return t.login.errAgeRange;
    if (mode === "signup" && password.length < MIN_PASSWORD) return t.login.errPasswordShort;
    if (mode === "signup" && password !== repeat) return t.login.errPasswordMismatch;
    return null;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (isDemo) {
      if (mode === "forgot") setDone({ kind: "reset", email });
      else router.push("/dashboard");
      return;
    }
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    const supabase = supabaseBrowser();
    const origin = window.location.origin;

    if (mode === "signin") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      setBusy(false);
      if (error) setError(t.login[authErrorKey(error)]);
      else router.push("/dashboard");
      return;
    }

    if (mode === "signup") {
      // Asked up front so a taken name is a friendly message, not a numbered
      // variant chosen by the trigger.
      if (!(await usernameAvailable(username))) {
        setBusy(false);
        setError(t.login.errUsernameTaken);
        return;
      }
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          // read by the handle_new_user trigger; anything but coach/client is
          // ignored there, and so are a malformed username, sex or birth year
          data: {
            full_name: fullName.trim(),
            role,
            username: username.trim(),
            sex,
            birth_year: String(birthYearFromAge(parseInt(age, 10))),
          },
          emailRedirectTo: `${origin}/auth/callback?next=/dashboard`,
        },
      });
      setBusy(false);
      if (error) {
        setError(t.login[authErrorKey(error)]);
        return;
      }
      // With confirmations on, Supabase hides "already registered" behind a
      // fake user with no identities, so the email can't be enumerated.
      if (data.user && data.user.identities?.length === 0) {
        setError(t.login.errEmailTaken);
        return;
      }
      // a session means confirmations are off — straight in
      if (data.session) router.push("/dashboard");
      else setDone({ kind: "confirm", email });
      return;
    }

    // forgot
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${origin}/auth/callback?next=/reset-password`,
    });
    setBusy(false);
    if (error) setError(t.login[authErrorKey(error)]);
    else setDone({ kind: "reset", email });
  }

  // Google covers both sign-in and sign-up: Supabase creates the account on
  // first consent. The coach/client choice cannot travel as user metadata on an
  // OAuth request, so it rides on the callback URL and is claimed there.
  async function google() {
    if (isDemo) {
      router.push("/dashboard");
      return;
    }
    setBusy(true);
    setError(null);
    const params = new URLSearchParams({ next: "/dashboard", flow: "oauth" });
    if (mode === "signup") params.set("role", role);
    const { error } = await supabaseBrowser().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback?${params}` },
    });
    // on success the browser is already leaving for Google
    if (error) {
      setBusy(false);
      setError(t.login.errOAuth);
    }
  }

  const submitLabel =
    mode === "signin" ? t.login.signIn : mode === "signup" ? t.login.createAccount : t.login.sendResetLink;

  if (done) {
    return (
      <div className="space-y-3 rounded-xl border border-line bg-surface p-5">
        <p className="text-base font-bold">
          {done.kind === "confirm" ? t.login.checkInboxTitle : t.login.resetSentTitle}
        </p>
        <p className="text-sm text-ink-soft">
          {(done.kind === "confirm" ? t.login.checkInboxBody : t.login.resetSentBody).replace(
            "{email}",
            done.email,
          )}
        </p>
        <button
          type="button"
          onClick={() => switchMode("signin")}
          className="w-full text-center text-xs text-ink-soft hover:underline"
        >
          {t.login.backToSignIn}
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-line bg-surface p-5" noValidate={isDemo}>
      {isDemo ? (
        <p className="rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn">{t.login.demoNotice}</p>
      ) : null}

      {mode === "signup" ? (
        <>
          <input
            type="text" autoComplete="name" value={fullName}
            onChange={(e) => setFullName(e.target.value)} placeholder={t.login.fullName}
            className={inputClass}
          />
          <div>
            <input
              type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} value={username}
              onChange={(e) => setUsername(e.target.value.trim())} placeholder={t.login.username}
              className={inputClass}
            />
            <p className="mt-1 text-[11px] text-ink-faint">{t.login.usernameHint}</p>
          </div>
          <div className="grid grid-cols-[1fr_5.5rem] gap-3">
            <fieldset className="min-w-0">
              <legend className="mb-1.5 text-xs font-medium text-ink-soft">{t.login.sex}</legend>
              <div className="grid grid-cols-3 gap-1.5">
                {SEXES.map((option) => (
                  <button
                    key={option} type="button" aria-pressed={sex === option} onClick={() => setSex(option)}
                    className={`truncate rounded-lg border px-1 py-2 text-[11px] font-semibold ${
                      sex === option ? "border-accent bg-accent-soft text-accent-ink" : "border-line bg-bg hover:border-ink-faint"
                    }`}
                  >
                    {option === "male" ? t.login.sexMale : option === "female" ? t.login.sexFemale : t.login.sexOther}
                  </button>
                ))}
              </div>
            </fieldset>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-ink-soft">{t.login.age}</span>
              <input
                inputMode="numeric" value={age}
                onChange={(e) => setAge(e.target.value.replace(/[^\d]/g, "").slice(0, 3))}
                className={`${inputClass} text-center tabular-nums`}
              />
            </label>
          </div>
          <fieldset>
            <legend className="mb-1.5 text-xs font-medium text-ink-soft">{t.login.iAm}</legend>
            <div className="grid grid-cols-2 gap-2">
              <RoleCard
                selected={role === "client"} onSelect={() => setRole("client")}
                title={t.login.roleClient} body={t.login.roleClientBody}
              />
              <RoleCard
                selected={role === "coach"} onSelect={() => setRole("coach")}
                title={t.login.roleCoach} body={t.login.roleCoachBody}
              />
            </div>
          </fieldset>
        </>
      ) : null}

      <input
        type="email" autoComplete="email" required={!isDemo} value={email}
        onChange={(e) => setEmail(e.target.value)} placeholder={t.login.email}
        className={inputClass}
      />

      {mode !== "forgot" ? (
        <input
          type="password" required={!isDemo} value={password}
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          minLength={mode === "signup" && !isDemo ? MIN_PASSWORD : undefined}
          onChange={(e) => setPassword(e.target.value)} placeholder={t.login.password}
          className={inputClass}
        />
      ) : null}

      {mode === "signup" ? (
        <>
          <input
            type="password" autoComplete="new-password" required={!isDemo} value={repeat}
            onChange={(e) => setRepeat(e.target.value)} placeholder={t.login.repeatPassword}
            className={inputClass}
          />
          <p className="text-xs text-ink-faint">{t.login.passwordHint}</p>
        </>
      ) : null}

      {error ? <p className="text-sm text-risk" role="alert">{error}</p> : null}

      <button
        type="submit" disabled={busy}
        className="w-full rounded-lg bg-accent py-2 text-sm font-semibold text-accent-fg hover:opacity-90 disabled:opacity-50"
      >
        {busy ? "…" : submitLabel}
      </button>

      {mode !== "forgot" && googleEnabled ? (
        <>
          <div className="flex items-center gap-3 py-1 text-[11px] uppercase tracking-wide text-ink-faint">
            <span className="h-px flex-1 bg-line" />
            {t.login.or}
            <span className="h-px flex-1 bg-line" />
          </div>
          <GoogleButton onClick={google} disabled={busy} label={t.login.continueWithGoogle} />
        </>
      ) : null}

      {mode === "signin" ? (
        <div className="flex flex-col gap-1.5 pt-1">
          <button type="button" onClick={() => switchMode("forgot")} className="text-center text-xs text-ink-soft hover:underline">
            {t.login.forgotPassword}
          </button>
          <button type="button" onClick={() => switchMode("signup")} className="text-center text-xs text-ink-soft hover:underline">
            {t.login.switchToSignUp}
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => switchMode("signin")} className="w-full text-center text-xs text-ink-soft hover:underline">
          {mode === "signup" ? t.login.switchToSignIn : t.login.backToSignIn}
        </button>
      )}
    </form>
  );
}

function GoogleButton({ onClick, disabled, label }: { onClick: () => void; disabled: boolean; label: string }) {
  return (
    <button
      type="button" onClick={onClick} disabled={disabled}
      className="flex w-full items-center justify-center gap-2.5 rounded-lg border border-line bg-bg py-2 text-sm font-semibold hover:border-ink-faint disabled:opacity-50"
    >
      {/* Google's "G" — brand mark, so its four colours are fixed by Google's guidelines */}
      <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
      </svg>
      {label}
    </button>
  );
}

function RoleCard({
  selected, onSelect, title, body,
}: { selected: boolean; onSelect: () => void; title: string; body: string }) {
  return (
    <button
      type="button" onClick={onSelect} aria-pressed={selected}
      className={`rounded-lg border p-2.5 text-left transition-colors ${
        selected ? "border-accent bg-accent-soft" : "border-line bg-bg hover:border-ink-faint"
      }`}
    >
      <span className={`block text-sm font-semibold ${selected ? "text-accent-ink" : ""}`}>{title}</span>
      <span className="mt-0.5 block text-[11px] leading-snug text-ink-soft">{body}</span>
    </button>
  );
}
