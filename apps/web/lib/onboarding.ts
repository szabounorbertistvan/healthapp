import "server-only";
import { cookies } from "next/headers";

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
