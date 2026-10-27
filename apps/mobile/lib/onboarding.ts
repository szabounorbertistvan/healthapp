import type { OnboardingV1 } from "@healthapp/api/v1";
import { RECIPES_LATER_DAYS, type OnboardingMark, type OnboardingState } from "@healthapp/shared/onboarding";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { api } from "./api";
import kv from "./kv";

// Onboarding on the phone — the web's OnboardingProvider (components/onboarding/
// provider.tsx): one read of the marks and the setup facts, and mark(), which
// writes one key through onboarding_mark() and keeps the map it answers. A mark
// the server refused is still applied here, so a closed card stays closed this
// session; the next read is the truth again. The model is the web's own
// (@healthapp/shared/onboarding).

export const ONBOARDING_KEY = ["onboarding"] as const;

export function useOnboarding() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ONBOARDING_KEY, queryFn: api.onboarding, staleTime: 60_000 });
  const data = query.data ?? null;
  const state: OnboardingState | null = data?.state ?? null;

  const mark = useCallback(async (key: string, how: OnboardingMark): Promise<boolean> => {
    const apply = (next: OnboardingState) =>
      queryClient.setQueryData<OnboardingV1>(ONBOARDING_KEY, (old) => (old ? { ...old, state: next } : old));
    const before = queryClient.getQueryData<OnboardingV1>(ONBOARDING_KEY)?.state ?? {};
    apply({ ...before, [key]: how });
    try {
      const r = await api.onboardingWrite("mark", { key, mark: how });
      if (r.ok && r.state) apply(r.state);
      return r.ok;
    } catch {
      return false;
    }
  }, [queryClient]);

  /** Read again after a step saved something the facts depend on (units, goal, photo). */
  const refresh = useCallback(() => queryClient.invalidateQueries({ queryKey: ONBOARDING_KEY }), [queryClient]);

  return { data, state, mark, refresh, query };
}

// "Later" on the recipes card: this device only, for RECIPES_LATER_DAYS (the
// web's RECIPES_LATER_COOKIE). Keyed by account, so another account on the
// same phone is not snoozed with it.
const laterKey = (userId: string) => `recipes-later:${userId}`;

export async function recipesLater(userId: string): Promise<boolean> {
  try {
    const until = Number(await kv.getItem(laterKey(userId)));
    return Number.isFinite(until) && until > Date.now();
  } catch {
    return false;
  }
}

export async function snoozeRecipes(userId: string): Promise<void> {
  try {
    await kv.setItem(laterKey(userId), String(Date.now() + RECIPES_LATER_DAYS * 24 * 60 * 60 * 1000));
  } catch {
    // a phone that cannot store it just shows the card again
  }
}
