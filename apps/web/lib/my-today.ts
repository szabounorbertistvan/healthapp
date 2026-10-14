// "Today" for the signed-in person, on their own calendar.
//
// isoDay() (lib/dates) answers in the SERVER's zone — UTC on Vercel — so for
// someone in Bucharest a meal logged at 00:30 landed on yesterday, the diary
// opened on yesterday until 03:00, and Today showed yesterday's weekday. The
// person's own screens now ask this instead: the day in `users.timezone`, the
// zone the streak, the progress dashboard and the training load count days in
// (packages/shared todayIn / localDay). An unknown zone falls back to the app
// default inside todayIn.
//
// The zone comes off getProfile(), which is request-cached and already read
// by the (client) layout, so a page pays no extra round trip for it.
//
// Rows written before this change keep the date they were written with —
// history is not rewritten.
import "server-only";
import { cache } from "react";
import { DEFAULT_TIMEZONE, todayIn } from "@healthapp/shared";
import { getProfile } from "./data";
import type { Calendar } from "./week-activity";

export const myCalendar = cache(async (): Promise<Calendar> => {
  const profile = await getProfile();
  const timeZone = profile?.timezone || DEFAULT_TIMEZONE;
  return { today: todayIn(timeZone), timeZone };
});

export const myToday = cache(async (): Promise<string> => (await myCalendar()).today);
