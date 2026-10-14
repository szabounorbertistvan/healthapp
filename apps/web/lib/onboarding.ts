import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { liveUser } from "./supabase/server";
import { isEmptyAccount } from "./client-today";
import { activeCoachId } from "./client-training";
import { getMyCoachProfileStatus } from "./coach-profile-data";
import {
  audienceOf, parseOnboardingState, type OnboardingState, type SetupFacts,
} from "./onboarding-model";
import type { Profile } from "./types";

// A brand-new client account has no coach, no program and no plan, so /today
// has nothing to show and sends them to /welcome. Choosing "I train on my own"
// is recorded here so that choice sticks even if they leave the builder before
// creating anything — otherwise every visit to /today would start over.
//
// A cookie, not a users column: it only decides which screen to show, it is
// not user data, and joining a coach or saving a program makes the account
// non-empty anyway. Per-device is an acceptable trade — the worst case is
// seeing /welcome once more on a new phone.

export const ONBOARDING_COOKIE = "bg_onboarding";
// One year, like the locale cookie — a choice should outlive the session.
export const ONBOARDING_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export async function hasChosenSolo(): Promise<boolean> {
  const jar = await cookies();
  return jar.get(ONBOARDING_COOKIE)?.value === "solo";
}

// "Later" on the recipes card (components/onboarding/recipes-card.tsx): the
// marks map has no dates, so the snooze is a cookie that expires by itself.
// Its value is the account id, so another account on the same browser is not
// snoozed with it. Per device, like the solo choice above.
export const RECIPES_LATER_COOKIE = "bg_recipes_later";

export async function recipesTipLater(userId: string): Promise<boolean> {
  const jar = await cookies();
  return jar.get(RECIPES_LATER_COOKIE)?.value === userId;
}

// The welcome cards, setup steps and page tours, by contrast, follow the
// person across devices: their marks live in onboarding_state (20261123100000);
// the model is lib/onboarding-model.ts.

/**
 * The signed-in person's onboarding marks; `null` when they cannot be read
 * (an unapplied migration, a failed request). Callers treat null as "unknown"
 * and show no guidance by themselves — see the model's header.
 */
export const getOnboardingState = cache(async (): Promise<OnboardingState | null> => {
  const live = await liveUser();
  if (!live) return null;
  const { data, error } = await live.supabase
    .from("onboarding_state").select("state").eq("user_id", live.userId).maybeSingle<{ state: unknown }>();
  if (error) {
    console.error(`onboarding state: ${error.message}`);
    return null;
  }
  return parseOnboardingState(data?.state ?? {});
});

/** What the setup steps need to know about the account, besides the marks. */
export type SetupSnapshot = {
  facts: SetupFacts;
  /** The client's active goal, as written (goals.title). */
  goal: string | null;
  /** Client: an active coach right now. */
  coached: boolean;
  /** Coach: their coach profile's status; null = none yet. */
  coachProfileStatus: string | null;
  /** Coach: at least one client relationship or invite exists. */
  hasClients: boolean;
};

const DEFAULTS = { timezone: "Europe/Bucharest", weight: "kg", length: "cm" } as const;

/**
 * One wave of reads — every query independent — then the facts. A read that
 * fails leaves its step open rather than failing the page: the worst case is
 * offering a step the person already did, which they can skip.
 */
export const getSetupSnapshot = cache(async (profile: Profile): Promise<SetupSnapshot> => {
  const live = await liveUser();
  const none: SetupSnapshot = { facts: {}, goal: null, coached: false, coachProfileStatus: null, hasClients: false };
  if (!live) return none;
  const { supabase, userId } = live;
  const photo = Boolean(profile.avatar_url);

  if (audienceOf(profile.role) === "client") {
    const [goal, accountEmpty, solo, coachId] = await Promise.all([
      supabase.from("goals").select("title").eq("user_id", userId).eq("status", "active")
        .order("created_at", { ascending: false }).limit(1).maybeSingle<{ title: string }>(),
      isEmptyAccount().catch((e: unknown) => {
        console.error(`onboarding facts: ${e instanceof Error ? e.message : String(e)}`);
        return true;
      }),
      hasChosenSolo(),
      // request-cached, and isEmptyAccount() asks the same question
      activeCoachId(userId).catch(() => null),
    ]);
    if (goal.error) console.error(`onboarding goal: ${goal.error.message}`);
    // Units and zone start at the defaults; anyone who changed one has answered the step.
    const units = profile.timezone !== DEFAULTS.timezone
      || profile.weight_unit !== DEFAULTS.weight || profile.length_unit !== DEFAULTS.length;
    return {
      facts: { photo, units, goal: Boolean(goal.data), training: !accountEmpty || solo },
      goal: goal.data?.title ?? null,
      coached: coachId !== null,
      coachProfileStatus: null,
      hasClients: false,
    };
  }

  const [status, relationships, programs] = await Promise.all([
    getMyCoachProfileStatus(),
    supabase.from("trainer_clients").select("id", { count: "exact", head: true }).eq("coach_id", userId),
    supabase.from("programs").select("id", { count: "exact", head: true }).eq("coach_id", userId),
  ]);
  if (relationships.error) console.error(`onboarding relationships: ${relationships.error.message}`);
  if (programs.error) console.error(`onboarding programs: ${programs.error.message}`);
  const hasClients = (relationships.count ?? 0) > 0;
  return {
    facts: {
      photo,
      // submitted counts: from here on the review is the admin's move, not theirs
      public_profile: status === "pending_review" || status === "published",
      invite: hasClients,
      program: (programs.count ?? 0) > 0,
    },
    goal: null,
    coached: false,
    coachProfileStatus: status,
    hasClients,
  };
});
