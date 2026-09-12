"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { PostVisibility } from "@healthapp/shared";
import { shareChallenge } from "@/app/social-actions";
import { useI18n } from "@/lib/i18n/client";
import { VisibilityPicker } from "./social";

/** "Share to feed" on a completed challenge — once; the server dedupes repeat taps and visits. */
export function ShareChallenge({ challengeId }: { challengeId: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [visibility, setVisibility] = useState<PostVisibility>("followers");
  const [done, setDone] = useState(false);
  const s = t.common.social;
  if (done) return <p className="text-sm font-semibold text-accent-ink">✓ {s.shared}</p>;
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
        className="min-h-11 w-full rounded-lg border border-line px-4 text-sm font-semibold hover:border-accent disabled:opacity-50 sm:w-auto"
      >
        {s.shareToFeed}
      </button>
    </div>
  );
}
