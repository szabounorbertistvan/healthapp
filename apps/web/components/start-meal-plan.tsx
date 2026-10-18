"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startMyMealPlan } from "@/app/nutrition-actions";
import { settle } from "@/lib/settle-action";
import { useI18n } from "@/lib/i18n/client";

/** "Start my meal plan": the person's own targets plan gets its four meal slots. */
export function StartMealPlanButton() {
  const { t } = useI18n();
  const m = t.clientApp.mealPlan;
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => {
          setError(null);
          const r = await settle(startMyMealPlan, t.common.actions.unreachable);
          if (r.ok) router.refresh();
          else setError(r.message ?? t.clientApp.recipes.failed);
        })}
        className="inline-flex h-11 items-center rounded-2xl bg-accent px-5 font-display text-sm font-bold text-accent-fg hover:opacity-90 disabled:opacity-50"
      >
        {pending ? m.starting : m.start}
      </button>
      <p className="mt-2 text-[12.5px] text-ink-faint">{m.startHint}</p>
      {error ? <p role="alert" className="mt-2 text-[13px] font-semibold text-risk">{error}</p> : null}
    </div>
  );
}
