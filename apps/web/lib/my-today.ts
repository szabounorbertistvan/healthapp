// "Today" for the signed-in person, on their own calendar.
//
// isoDay() (lib/dates) answers in the SERVER's zone — UTC on Vercel — so for
// someone in Bucharest a meal logged at 00:30 landed on yesterday, and the
// diary opened on yesterday until 03:00. The food diary now asks this instead:
// the day in `users.timezone`, the zone the streak, the progress dashboard
// and the training load already count days in (packages/shared todayIn). An
// unknown zone falls back to the app default inside todayIn; no signed-in
// user falls back to isoDay().
//
// The zone comes off getProfile(), which is request-cached and already read
// by the (client) layout, so a page pays no extra round trip for it.
//
// Rows logged before this change keep the date they were written with —
// history is not rewritten.
import "server-only";
import { cache } from "react";
import { todayIn } from "@healthapp/shared";
import { getProfile } from "./data";
import { isoDay } from "./dates";

export const myToday = cache(async (): Promise<string> => {
  const profile = await getProfile();
  return profile ? todayIn(profile.timezone) : isoDay();
});
