"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { completeProfile } from "@/app/profile-actions";
import { useI18n } from "@/lib/i18n/client";
import { isValidAge, isValidUsername, SEXES } from "@/lib/profile";
import type { Sex } from "@/lib/types";

const inputClass =
  "w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent";

/**
 * Fills in what a sign-up may have skipped: name, username, sex, age. Reached
 * from either layout when `users.username` is null (Google accounts, accounts
 * from before the field existed). `next` is where to go once saved.
 */
export function CompleteProfileForm({
  initialName,
  next,
}: {
  initialName: string;
  next: string;
}) {
  const { t } = useI18n();
  const m = t.clientApp.completeProfile;
  const router = useRouter();
  const [fullName, setFullName] = useState(initialName.includes("@") ? "" : initialName);
  const [username, setUsername] = useState("");
  const [sex, setSex] = useState<Sex | "">("");
  const [age, setAge] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const sexLabel: Record<Sex, string> = {
    male: t.login.sexMale, female: t.login.sexFemale, other: t.login.sexOther,
  };

  function validate(): string | null {
    if (!fullName.trim()) return m.errName;
    if (!isValidUsername(username)) return m.errUsernameFormat;
    if (!sex) return m.errSex;
    if (!isValidAge(parseInt(age, 10))) return m.errAge;
    return null;
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    startTransition(async () => {
      setError(null);
      const result = await completeProfile({
        fullName, username, sex: sex as Sex, age: parseInt(age, 10),
      });
      if (!result.ok) {
        setError(
          result.errorCode === "USERNAME_TAKEN" ? m.errUsernameTaken
          : result.errorCode === "USERNAME_FORMAT" ? m.errUsernameFormat
          : result.errorCode === "AGE" ? m.errAge
          : result.errorCode === "SEX" ? m.errSex
          : result.errorCode === "NAME" ? m.errName
          : result.message ?? m.errGeneric,
        );
        return;
      }
      router.push(next);
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-line bg-surface p-5">
      <p className="text-sm text-ink-soft">{m.body}</p>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-ink-soft">{m.fullName}</span>
        <input type="text" autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} className={inputClass} />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-ink-soft">{m.username}</span>
        <input
          type="text" autoComplete="username" autoCapitalize="none" value={username}
          onChange={(e) => setUsername(e.target.value.trim())} className={inputClass}
        />
        <span className="mt-1 block text-[11px] text-ink-faint">{m.usernameHint}</span>
      </label>
      <fieldset>
        <legend className="mb-1.5 text-xs font-medium text-ink-soft">{m.sex}</legend>
        <div className="grid grid-cols-3 gap-2">
          {SEXES.map((option) => (
            <button
              key={option} type="button" aria-pressed={sex === option} onClick={() => setSex(option)}
              className={`rounded-lg border px-2 py-2 text-sm font-semibold ${
                sex === option ? "border-accent bg-accent-soft text-accent-ink" : "border-line bg-bg hover:border-ink-faint"
              }`}
            >
              {sexLabel[option]}
            </button>
          ))}
        </div>
      </fieldset>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-ink-soft">{m.age}</span>
        <input
          inputMode="numeric" value={age}
          onChange={(e) => setAge(e.target.value.replace(/[^\d]/g, "").slice(0, 3))}
          className={`${inputClass} w-24`}
        />
      </label>
      {error ? <p className="text-sm text-risk" role="alert">{error}</p> : null}
      <button
        type="submit" disabled={pending}
        className="w-full rounded-lg bg-accent py-2 text-sm font-semibold text-accent-fg hover:opacity-90 disabled:opacity-50"
      >
        {pending ? "…" : m.save}
      </button>
    </form>
  );
}
