"use server";
import { revalidatePath } from "next/cache";
import { isDemo, supabaseServer } from "@/lib/supabase/server";
import { mutated } from "@/lib/supabase/mutate";
import { birthYearFromAge, isValidAge, isValidUsername, SEXES } from "@/lib/profile";
import type { Sex } from "@/lib/types";
import type { ActionResult } from "./actions";

// Profile fields the account carries beyond the auth row: username, sex, year
// of birth. Sign-up collects them as user metadata (handle_new_user copies them
// over); an account that arrived without them — Google, or one made before the
// fields existed — fills them in on /complete-profile through completeProfile().

export async function usernameAvailable(username: string): Promise<boolean> {
  const wanted = username.trim();
  if (!isValidUsername(wanted)) return false;
  if (isDemo) return wanted.toLowerCase() !== "coach_alex";
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

  if (isDemo) return { ok: true, demo: true };

  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, message: "Not signed in" };
  if (!(await usernameAvailable(username))) return { ok: false, errorCode: "USERNAME_TAKEN" };

  const failed = await mutated(
    await supabase
      .from("users")
      .update(
        { full_name: fullName, username, sex: input.sex, birth_year: birthYearFromAge(input.age) },
        { count: "exact" },
      )
      .eq("id", auth.user.id),
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
