"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { EMAIL_PREF_CATEGORIES, type Role } from "@healthapp/shared";
import { saveEmailPref } from "@/app/email-actions";
import { useI18n } from "@/lib/i18n/client";
import { Card, Switch } from "./ui";

type CategoryKey = keyof ReturnType<typeof useI18n>["t"]["clientWidgets"]["emailPrefs"]["categories"];

/**
 * The marketplace email switches on /account and the coach's /settings, one per
 * category (docs/MARKETPLACE_EMAIL.md §6). Requests, bookings and the coach page
 * are on until switched off; messages and reviews are off until switched on.
 * "Your coach page" is shown only to someone who coaches.
 */
export function EmailPrefsCard({ prefs, role }: { prefs: Record<string, boolean>; role: Role }) {
  const { t } = useI18n();
  const m = t.clientWidgets.emailPrefs;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [state, setState] = useState(prefs);
  const [error, setError] = useState<string | null>(null);
  const coaches = role !== "client";

  function toggle(category: string, on: boolean) {
    setError(null);
    setState((s) => ({ ...s, [category]: on }));
    start(async () => {
      const result = await saveEmailPref(category, on);
      if (!result.ok) {
        setState((s) => ({ ...s, [category]: !on }));
        setError(m.couldNotSave);
        return;
      }
      router.refresh();
    });
  }

  return (
    <Card plain>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{m.title}</p>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-faint">{m.intro}</p>
      <div className="mt-4 grid gap-4">
        {EMAIL_PREF_CATEGORIES.filter((c) => coaches || !c.coachOnly).map(({ category }) => {
          const copy = m.categories[category as CategoryKey];
          if (!copy) return null;
          return (
            <Switch
              key={category}
              checked={state[category] ?? false}
              onChange={(on) => toggle(category, on)}
              disabled={pending}
              label={copy.label}
              hint={copy.hint}
              onLabel={m.on}
              offLabel={m.off}
            />
          );
        })}
      </div>
      {error ? <p role="alert" className="mt-3 text-[12.5px] text-risk">{error}</p> : null}
    </Card>
  );
}
