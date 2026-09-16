"use server";
import { revalidatePath } from "next/cache";
import { liveUser, supabaseServer } from "@/lib/supabase/server";
import { mutated } from "@/lib/supabase/mutate";
import { birthYearFromAge, isValidAge, isValidUsername, SEXES } from "@/lib/profile";
import type { Sex } from "@/lib/types";
import type { ActionResult } from "./actions";
import { notSignedIn } from "@/lib/action-result";
import { exportMyData } from "@/lib/data-export";

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
}): Promise<ActionResult> {
  const fullName = input.fullName.trim();
  const username = input.username.trim();
  if (!fullName) return { ok: false, errorCode: "NAME", message: "Tell us your name" };
  if (!isValidUsername(username)) return { ok: false, errorCode: "USERNAME_FORMAT" };
  if (!SEXES.includes(input.sex)) return { ok: false, errorCode: "SEX" };
  if (!isValidAge(input.age)) return { ok: false, errorCode: "AGE" };


  const live = await liveUser();
  if (!live) return notSignedIn;
  const { supabase, userId } = live;
  if (!(await usernameAvailable(username))) return { ok: false, errorCode: "USERNAME_TAKEN" };

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
  timezone: string;
}): Promise<ActionResult> {
  const fullName = input.fullName.trim();
  const username = input.username.trim();
  const timezone = input.timezone.trim();
  if (!fullName) return { ok: false, errorCode: "NAME", message: "Tell us your name" };
  if (!isValidUsername(username)) return { ok: false, errorCode: "USERNAME_FORMAT" };
  // Reject anything Postgres would not accept as a zone rather than storing a
  // string that makes every scheduled job skip this user for ever.
  if (!isValidTimeZone(timezone)) return { ok: false, message: "Unknown time zone" };

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
      .update({ full_name: fullName, username, timezone }, { count: "exact" })
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
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("request_account_deletion");
  if (error) return { ok: false, message: error.message };
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
