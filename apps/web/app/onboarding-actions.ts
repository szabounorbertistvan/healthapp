"use server";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { isLengthUnit, isWeightUnit, type LengthUnit, type WeightUnit } from "@healthapp/shared";
import { liveUser } from "@/lib/supabase/server";
import { mutated } from "@/lib/supabase/mutate";
import { notSignedIn } from "@/lib/action-result";
import { getProfile } from "@/lib/data";
import { getI18n } from "@/lib/i18n/server";
import { CLIENT_GOALS, type ClientGoal } from "@/lib/coach-content";
import {
  RECIPES_LATER_DAYS, isOnboardingKey, isOnboardingMark, parseOnboardingState, type OnboardingMark, type OnboardingState,
} from "@/lib/onboarding-model";
import { RECIPES_LATER_COOKIE } from "@/lib/onboarding";
import { chooseSoloTraining } from "./client-actions";
import { updateAccount } from "./profile-actions";
import type { ActionResult } from "./actions";

export type OnboardingResult = ActionResult & { state?: OnboardingState };

/**
 * Set one onboarding mark (or clear it with "reset") through onboarding_mark()
 * — the only write path to onboarding_state (20261123100000). Returns the whole
 * map so the caller can replace its copy.
 */
export async function markOnboarding(key: string, mark: OnboardingMark | "reset"): Promise<OnboardingResult> {
  if (!isOnboardingKey(key) || (mark !== "reset" && !isOnboardingMark(mark))) {
    return { ok: false, errorCode: "INVALID_INPUT" };
  }
  const live = await liveUser();
  if (!live) return notSignedIn;
  const { data, error } = await live.supabase.rpc("onboarding_mark", { p_key: key, p_mark: mark });
  if (error) {
    console.error(`onboarding_mark failed: ${error.message}`);
    return { ok: false, message: error.message };
  }
  // Tour marks change nothing a server component renders; the rest decide
  // redirects and the setup card on Today / the dashboard.
  if (!key.startsWith("tour:")) revalidatePath("/", "layout");
  return { ok: true, state: parseOnboardingState(data) };
}

/**
 * "Later" on the recipes card: hidden on this device for RECIPES_LATER_DAYS,
 * then it comes back by itself. Nothing is marked, so nothing is lost.
 */
export async function snoozeRecipesTip(): Promise<ActionResult> {
  const live = await liveUser();
  if (!live) return notSignedIn;
  const jar = await cookies();
  jar.set(RECIPES_LATER_COOKIE, live.userId, {
    maxAge: RECIPES_LATER_DAYS * 24 * 60 * 60,
    path: "/",
    sameSite: "lax",
    httpOnly: true,
  });
  return { ok: true };
}

/**
 * The units-and-zone step: the same write as the account screen (updateAccount),
 * with the profile as it stands as the baseline, so only what this step
 * changed is written and every other field is left exactly as it is.
 */
export async function saveSetupUnits(input: {
  weightUnit: WeightUnit;
  lengthUnit: LengthUnit;
  timezone: string;
}): Promise<OnboardingResult> {
  if (!isWeightUnit(input.weightUnit) || !isLengthUnit(input.lengthUnit)) return { ok: false, errorCode: "INVALID_INPUT" };
  const profile = await getProfile();
  if (!profile) return notSignedIn;
  const baseline = {
    fullName: profile.full_name,
    username: profile.username ?? "",
    city: profile.city ?? "",
    bio: profile.bio ?? "",
    timezone: profile.timezone,
    checkInWeekday: profile.check_in_weekday,
    leaderboardVisibility: profile.leaderboard_visibility,
    weightUnit: profile.weight_unit,
    lengthUnit: profile.length_unit,
  };
  const saved = await updateAccount(
    { ...baseline, weightUnit: input.weightUnit, lengthUnit: input.lengthUnit, timezone: input.timezone },
    baseline,
  );
  if (!saved.ok) return saved;
  return markOnboarding("step:units", "done");
}

/** goals.type is a coarse bucket (20260823000200); the goal itself travels in the title. */
const GOAL_TYPE: Partial<Record<ClientGoal, "weight" | "strength" | "habit">> = {
  fat_loss: "weight",
  strength: "strength",
  healthy_habits: "habit",
};

/**
 * The goal step: one active goal in `goals`, which the coach already may read
 * (goals_coach_read) and which now shows on their page for this client. Picking
 * again replaces the goal's wording instead of piling up goals. The title is
 * written in the person's language, like everything else they type.
 */
export async function saveSetupGoal(goal: ClientGoal): Promise<OnboardingResult> {
  if (!(CLIENT_GOALS as readonly string[]).includes(goal)) return { ok: false, errorCode: "INVALID_INPUT" };
  const live = await liveUser();
  if (!live) return notSignedIn;
  const { supabase, userId } = live;
  const { t } = await getI18n();
  const row = { type: GOAL_TYPE[goal] ?? "other", title: t.coachProfile.expertise.goals[goal] };

  const { data: current, error: readError } = await supabase
    .from("goals").select("id").eq("user_id", userId).eq("status", "active")
    .order("created_at", { ascending: false }).limit(1).maybeSingle<{ id: string }>();
  if (readError) return { ok: false, message: readError.message };

  if (current) {
    const failed = await mutated(await supabase.from("goals").update(row, { count: "exact" }).eq("id", current.id));
    if (failed) return failed;
  } else {
    const { error } = await supabase.from("goals").insert({ user_id: userId, ...row });
    if (error) return { ok: false, message: error.message };
  }
  return markOnboarding("step:goal", "done");
}

/** "I train on my own" from the training step: the /welcome choice itself, then the step. */
export async function chooseSoloFromSetup(): Promise<OnboardingResult> {
  const chosen = await chooseSoloTraining();
  if (!chosen.ok) return chosen;
  return markOnboarding("step:training", "done");
}
