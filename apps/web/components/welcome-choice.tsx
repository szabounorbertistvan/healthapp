"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { chooseSoloTraining } from "@/app/client-actions";
import { Card } from "@/components/ui";
import { JoinCoach } from "@/components/join-coach";
import { useI18n } from "@/lib/i18n/client";

export function WelcomeChoice() {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const w = t.clientApp.welcome;

  return (
    <div className="space-y-3">
      <Card className="space-y-2">
        <p className="font-bold">{w.withCoachTitle}</p>
        <p className="text-sm text-ink-soft">{w.withCoachBody}</p>
        {/* The code box itself lives in JoinCoach — the Coach tab offers the
            same thing to a client whose account is no longer empty. */}
        <JoinCoach redirectTo="/today" />
      </Card>

      <Card className="space-y-2">
        <p className="font-bold">{w.soloTitle}</p>
        <p className="text-sm text-ink-soft">{w.soloBody}</p>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              await chooseSoloTraining();
              router.push("/workout/build");
            })
          }
          className="min-h-11 w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-fg disabled:opacity-40"
        >
          {w.startSolo}
        </button>
      </Card>

      <p className="text-center text-xs text-ink-faint">{w.notFinal}</p>
    </div>
  );
}
