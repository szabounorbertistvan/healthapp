"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { settle } from "@/lib/settle-action";
import { useI18n } from "@/lib/i18n/client";

/**
 * The "save, then refresh" used by the builders. A dropped connection becomes
 * the failed result the screen already shows, instead of the error boundary
 * taking the open editor with it. `startTransition` is the same one `run`
 * uses, so a confirm step beside it shares the pending state.
 */
export function useSettledAction(fallback: string) {
  const router = useRouter();
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /** `undo` puts an optimistic change back when the action fails (the nutrition builder's in-flight grams). */
  function run(action: () => Promise<{ ok: boolean; message?: string }>, undo?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await settle(action, t.common.actions.unreachable);
      if (!result.ok) {
        setError(result.message ?? fallback);
        undo?.();
      }
      router.refresh();
    });
  }

  return { error, setError, pending, run, startTransition };
}
