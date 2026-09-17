"use server";
import { revalidatePath } from "next/cache";
import { liveUser, supabaseServer } from "@/lib/supabase/server";
import { mutated } from "@/lib/supabase/mutate";
import { isLengthUnit, isWeightUnit, type LengthUnit, type WeightUnit } from "@healthapp/shared";
import { birthYearFromAge, isValidAge, isValidUsername, SEXES } from "@/lib/profile";
import type { Sex } from "@/lib/types";
import type { Role } from "@/lib/entitlements";
import type { ActionResult } from "./actions";
import { notSignedIn } from "@/lib/action-result";
import { exportMyData } from "@/lib/data-export";
import {
  AVATAR_PUBLIC_ID, avatarFolder, avatarUrl, cloudinaryConfigured, CloudinaryNotConfiguredError,
  destroyAvatar, destroyUserPhotos, signAvatarUpload, type AvatarUploadTicket,
} from "@/lib/cloudinary";

const MAX_CITY = 80;
const MAX_BIO = 500;

// Profile fields the account carries beyond the auth row: username, sex, year
// of birth. Sign-up collects them as user metadata (handle_new_user copies them
// over); an account that arrived without them — Google, or one made before the
// fields existed — fills them in on /complete-profile through completeProfile().

export async function usernameAvailable(username: string): Promise<boolean> {
  const wanted = username.trim();
  if (!isValidUsername(wanted)) return false;
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("username_available", { p_username: wanted });
  // An unreachable check must not block sign-up: the trigger de-duplicates
  // anyway, so "available" is the safe answer here.
  if (error) return true;
  return Boolean(data);
}

export async function completeProfile(input: {
  fullName: string;
  username: string;
  sex: Sex;
  age: number;
  /**
   * Coach or client. The "sign in" tab's Google button creates accounts with
   * no role choice at all, so this step is where such an account first gets
   * asked. claim_signup_role() only honours it while the profile is still
   * unfinished (username null) — never for admins, never later.
   */
  role: Role;
}): Promise<ActionResult> {
  const fullName = input.fullName.trim();
  const username = input.username.trim();
  if (!fullName) return { ok: false, errorCode: "NAME", message: "Tell us your name" };
  if (!isValidUsername(username)) return { ok: false, errorCode: "USERNAME_FORMAT" };
  if (!SEXES.includes(input.sex)) return { ok: false, errorCode: "SEX" };
  if (!isValidAge(input.age)) return { ok: false, errorCode: "AGE" };
  if (input.role !== "coach" && input.role !== "client") return { ok: false, errorCode: "ROLE" };

  const live = await liveUser();
  if (!live) return notSignedIn;
  const { supabase, userId } = live;
  if (!(await usernameAvailable(username))) return { ok: false, errorCode: "USERNAME_TAKEN" };

  // Before the username lands: once it is set the profile counts as complete
  // and claim_signup_role() no longer acts on the row.
  const { error: roleError } = await supabase.rpc("claim_signup_role", { p_role: input.role });
  if (roleError) return { ok: false, message: roleError.message };

  const failed = await mutated(
    await supabase
      .from("users")
      .update(
        { full_name: fullName, username, sex: input.sex, birth_year: birthYearFromAge(input.age) },
        { count: "exact" },
      )
      .eq("id", userId),
  );
  if (failed) {
    // The unique index catches a race the availability check missed.
    if (failed.message?.includes("users_username_lower_idx")) {
      return { ok: false, errorCode: "USERNAME_TAKEN" };
    }
    return failed;
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Change the account fields a client can edit after sign-up. Sex and year of
 * birth are deliberately not here: they are set once on /complete-profile and
 * only ever feed the macro formulas, so a settings screen that let someone
 * churn them would quietly rewrite their targets.
 *
 * `timezone` is not decoration — detect_streak_risk() and detect_checkin_due()
 * fire on the user's *local* hour, so a wrong zone means the reminder lands at
 * the wrong time of day.
 */
export async function updateAccount(input: {
  fullName: string;
  username: string;
  city: string;
  bio: string;
  timezone: string;
  /** 0 = Sunday … 6 = Saturday, matching users.check_in_weekday. */
  checkInWeekday: number;
  leaderboardVisibility: "public" | "followers" | "private";
  weightUnit: WeightUnit;
  lengthUnit: LengthUnit;
}): Promise<ActionResult> {
  const fullName = input.fullName.trim();
  const username = input.username.trim();
  const timezone = input.timezone.trim();
  const city = input.city.trim();
  const bio = input.bio.trim();
  if (!fullName) return { ok: false, errorCode: "NAME", message: "Tell us your name" };
  if (!isValidUsername(username)) return { ok: false, errorCode: "USERNAME_FORMAT" };
  // Mirrors the check constraints from 20260917100000.
  if (city.length > MAX_CITY) return { ok: false, errorCode: "CITY" };
  if (bio.length > MAX_BIO) return { ok: false, errorCode: "BIO" };
  // Reject anything Postgres would not accept as a zone rather than storing a
  // string that makes every scheduled job skip this user for ever.
  if (!isValidTimeZone(timezone)) return { ok: false, message: "Unknown time zone" };
  if (!Number.isInteger(input.checkInWeekday) || input.checkInWeekday < 0 || input.checkInWeekday > 6) {
    return { ok: false, message: "Pick a check-in day" };
  }
  if (!LEADERBOARD_VISIBILITY.includes(input.leaderboardVisibility)) {
    return { ok: false, message: "Unknown visibility" };
  }
  if (!isWeightUnit(input.weightUnit) || !isLengthUnit(input.lengthUnit)) {
    return { ok: false, message: "Unknown unit" };
  }

  const live = await liveUser();
  if (!live) return notSignedIn;
  const { supabase, userId } = live;

  // Only check availability when it actually changed: comparing against your
  // own username would always come back "taken".
  const { data: current } = await supabase.from("users").select("username").eq("id", userId).single();
  if (current?.username?.toLowerCase() !== username.toLowerCase() && !(await usernameAvailable(username))) {
    return { ok: false, errorCode: "USERNAME_TAKEN" };
  }

  const failed = await mutated(
    await supabase
      .from("users")
      .update(
        {
          full_name: fullName,
          username,
          city: city || null,
          bio: bio || null,
          timezone,
          check_in_weekday: input.checkInWeekday,
          leaderboard_visibility: input.leaderboardVisibility,
          weight_unit: input.weightUnit,
          length_unit: input.lengthUnit,
        },
        { count: "exact" },
      )
      .eq("id", userId),
  );
  if (failed) {
    if (failed.message?.includes("users_username_lower_idx")) {
      return { ok: false, errorCode: "USERNAME_TAKEN" };
    }
    return failed;
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

// ---------- profile picture ----------
// Same shape as progress photos (photo-actions.ts): the browser asks for a
// signed ticket, posts the file straight to Cloudinary, then reports back and
// the column is written only once the asset exists.

export async function requestAvatarUpload(): Promise<ActionResult & { ticket?: AvatarUploadTicket }> {
  const live = await liveUser();
  if (!live) return notSignedIn;
  try {
    return { ok: true, ticket: signAvatarUpload(live.userId) };
  } catch (error) {
    if (error instanceof CloudinaryNotConfiguredError) {
      console.error(error.message);
      return { ok: false, message: error.message };
    }
    throw error;
  }
}

export async function saveAvatar(input: { publicId: string; version: number }): Promise<ActionResult> {
  const live = await liveUser();
  if (!live) return notSignedIn;
  const { supabase, userId } = live;
  // The id is fixed per person, so anything else is not an upload this server
  // signed. The URL is rebuilt here rather than trusted from the browser.
  if (input.publicId !== `${avatarFolder(userId)}/${AVATAR_PUBLIC_ID}`) {
    return { ok: false, message: "Unexpected upload path" };
  }
  if (!Number.isInteger(input.version) || input.version <= 0) {
    return { ok: false, message: "Unexpected upload version" };
  }
  const failed = await mutated(
    await supabase
      .from("users")
      .update({ avatar_url: avatarUrl(input.publicId, input.version) }, { count: "exact" })
      .eq("id", userId),
  );
  if (failed) return failed;
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function removeAvatar(): Promise<ActionResult> {
  const live = await liveUser();
  if (!live) return notSignedIn;
  const { supabase, userId } = live;
  const failed = await mutated(
    await supabase.from("users").update({ avatar_url: null }, { count: "exact" }).eq("id", userId),
  );
  if (failed) return failed;
  // The column is the record; a Google-inherited URL has no asset of ours to
  // remove, and a failed Cloudinary call must not undo the removal.
  if (cloudinaryConfigured()) {
    try {
      await destroyAvatar(userId);
    } catch (error) {
      console.error("avatar asset not removed:", (error as Error).message);
    }
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

/** The locale the SQL notification jobs write in; the UI itself reads a cookie. */
export async function saveLocalePreference(locale: "ro" | "en"): Promise<ActionResult> {
  const live = await liveUser();
  if (!live) return notSignedIn;
  const { supabase, userId } = live;
  const failed = await mutated(
    await supabase.from("users").update({ locale }, { count: "exact" }).eq("id", userId),
  );
  return failed ?? { ok: true };
}

/** Mirrors the check constraint added with the leaderboards migration. */
const LEADERBOARD_VISIBILITY = ["public", "followers", "private"] as const;

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * GDPR art. 17. The database does the work — request_account_deletion() stamps
 * the request, anonymises the profile and ends every coaching relationship in
 * one transaction, and the purge job removes the rows after the 30-day window.
 */
export async function requestAccountDeletion(): Promise<ActionResult & { purgeAfter?: string }> {
  const live = await liveUser();
  if (!live) return notSignedIn;
  const { supabase, userId } = live;
  const { data, error } = await supabase.rpc("request_account_deletion");
  if (error) return { ok: false, message: error.message };

  // Progress photos live in Cloudinary, which the SQL purge job cannot reach.
  // Best effort, loudly logged: a silent leftover here is the worst kind.
  if (cloudinaryConfigured()) {
    try {
      await destroyUserPhotos(userId);
    } catch (photoError) {
      console.error("progress photos not removed on deletion:", (photoError as Error).message);
    }
  }
  revalidatePath("/", "layout");
  return { ok: true, purgeAfter: (data as { purge_after?: string } | null)?.purge_after };
}

/**
 * GDPR art. 15/20. Returns the whole account as a JSON string for the browser
 * to save; the rows are gathered in lib/data-export.ts, which documents what is
 * included and why.
 */
export async function downloadMyData(): Promise<ActionResult & { json?: string; filename?: string }> {
  const data = await exportMyData();
  if (!data) return notSignedIn;
  const day = new Date().toISOString().slice(0, 10);
  return { ok: true, json: JSON.stringify(data, null, 2), filename: `voinic-data-${day}.json` };
}
