"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { acceptInvite, chooseSoloTraining } from "@/app/client-actions";
import { Card } from "@/components/ui";
import { useI18n } from "@/lib/i18n/client";

export function WelcomeChoice() {
  const { t } = useI18n();
  const router = useRouter();
  const [mode, setMode] = useState<null | "coach">(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const w = t.clientApp.welcome;

  // accept_invite's business codes → copy; anything unrecognised gets the generic line
  const inviteError = (code: string | undefined) =>
    code === "INVALID_CODE" ? w.errInvalidCode
    : code === "EXPIRED" ? w.errExpired
    : code === "ALREADY_HAS_COACH" ? w.errAlreadyHasCoach
    : w.errUnknown;

  return (
    <div className="space-y-3">
      <Card className="space-y-2">
        <p className="font-bold">{t.clientApp.welcome.withCoachTitle}</p>
        <p className="text-sm text-ink-soft">{t.clientApp.welcome.withCoachBody}</p>
        {mode === "coach" ? (
          <>
            <input
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={t.clientApp.welcome.codePlaceholder}
              className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm uppercase outline-none focus:border-accent"
            />
            <button
              type="button"
              disabled={pending || !code.trim()}
              onClick={() =>
                startTransition(async () => {
                  setError(null);
                  const r = await acceptInvite(code);
                  if (!r.ok) setError(inviteError(r.code));
                  else router.push("/today");
                })
              }
              className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-fg disabled:opacity-40"
            >
              {t.clientApp.welcome.useCode}
            </button>
            {error ? <p className="text-sm text-risk">{error}</p> : null}
          </>
        ) : (
          <button
            type="button"
            onClick={() => setMode("coach")}
            className="w-full rounded-lg border border-line px-4 py-2.5 text-sm font-semibold hover:border-accent"
          >
            {t.clientApp.welcome.haveCode}
          </button>
        )}
      </Card>

      <Card className="space-y-2">
        <p className="font-bold">{t.clientApp.welcome.soloTitle}</p>
        <p className="text-sm text-ink-soft">{t.clientApp.welcome.soloBody}</p>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              await chooseSoloTraining();
              router.push("/workout/build");
            })
          }
          className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-fg disabled:opacity-40"
        >
          {t.clientApp.welcome.startSolo}
        </button>
      </Card>

      <p className="text-center text-xs text-ink-faint">{t.clientApp.welcome.notFinal}</p>
    </div>
  );
}
