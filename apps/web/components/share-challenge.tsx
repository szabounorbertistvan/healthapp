"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { PostVisibility } from "@healthapp/shared";
import { shareChallenge } from "@/app/social-actions";
import { useI18n } from "@/lib/i18n/client";
import { NavIcon } from "./client-nav";
import { VisibilityPicker } from "./social";

const CHECK = "m5 12 5 5 9-10";

/** "Share to feed" on a completed challenge — once; the server dedupes repeat taps and visits. */
export function ShareChallenge({ challengeId }: { challengeId: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [visibility, setVisibility] = useState<PostVisibility>("followers");
  const [done, setDone] = useState(false);
  const s = t.common.social;
  if (done) {
    return (
      <p className="flex items-center gap-1.5 text-sm font-semibold text-accent-ink">
        <NavIcon d={CHECK} className="h-4 w-4 [stroke-width:2.4]" />
        {s.shared}
      </p>
    );
  }
  return (
    <div className="space-y-3">
      <VisibilityPicker value={visibility} onChange={setVisibility} />
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const r = await shareChallenge(challengeId, visibility);
            if (r.ok) setDone(true);
            router.refresh();
          })
        }
        className="flex h-11 w-full items-center justify-center rounded-2xl bg-bg px-5 text-sm font-semibold text-ink-soft hover:text-ink disabled:opacity-50 sm:w-auto"
      >
        {s.shareToFeed}
      </button>
    </div>
  );
}
