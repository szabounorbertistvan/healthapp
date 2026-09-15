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
    <div>
      {/* Two equal cards: the action of each sits at the bottom edge (mt-auto),
          so both read as the same size of decision. */}
      <div className="grid gap-3.5 sm:grid-cols-2">
        <Card plain className="flex flex-col sm:p-6">
          <p className="font-display text-lg font-bold tracking-tight">{w.withCoachTitle}</p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">{w.withCoachBody}</p>
          {/* The code box itself lives in JoinCoach — the Coach tab offers the
              same thing to a client whose account is no longer empty. */}
          <div className="mt-auto space-y-2 pt-4">
            <JoinCoach redirectTo="/today" />
          </div>
        </Card>

        <Card plain className="flex flex-col sm:p-6">
          <p className="font-display text-lg font-bold tracking-tight">{w.soloTitle}</p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">{w.soloBody}</p>
          <div className="mt-auto pt-4">
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await chooseSoloTraining();
                  router.push("/workout/build");
                })
              }
              className="flex h-11 w-full items-center justify-center rounded-2xl bg-accent px-5 font-display text-sm font-bold text-accent-fg hover:opacity-90 disabled:opacity-40"
            >
              {w.startSolo}
            </button>
          </div>
        </Card>
      </div>

      <p className="mt-4 text-center text-[12.5px] text-ink-faint">{w.notFinal}</p>
    </div>
  );
}
