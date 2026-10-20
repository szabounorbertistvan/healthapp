"use server";
// Habit ticks. The log id is derived from the habit and the day, so ticking
// twice cannot insert two rows.
import { revalidatePath } from "next/cache";
import { myToday } from "@/lib/my-today";
import { liveUser } from "@/lib/supabase/server";
import { mutated } from "@/lib/supabase/mutate";
import { uuidFrom } from "@/lib/stable-id";
import { validDay } from "@/lib/week";
import type { ActionResult } from "./actions";
import { notSignedIn } from "@/lib/action-result";



export async function toggleHabit(habitId: string, requested?: string): Promise<ActionResult> {
  // Today on the person's own calendar — what getMyHabits reads as "done today".
  const day = requested ?? (await myToday());
  const live = await liveUser();
  if (!live) return notSignedIn;
  const { supabase, userId } = live;
  const { data: existing } = await supabase
    .from("habit_logs")
    .select("id")
    .eq("habit_id", habitId)
    .eq("date", day)
    .maybeSingle();
  const { error } = existing
    ? await supabase.from("habit_logs").delete().eq("id", existing.id)
    : await supabase.from("habit_logs").insert({
        habit_id: habitId,
        user_id: userId,
        date: day,
        client_generated_id: uuidFrom(`${habitId}:${day}`),
      });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/today");
  revalidatePath("/habits");
  return { ok: true };
}



/**
 * Set a habit's tick for one day to a known state — what the offline outbox
 * replays. Unlike toggleHabit it can be delivered twice: done twice is still
 * done (the log id is derived), not done twice is still not done.
 */
export async function setHabitDone(habitId: string, day: string, done: boolean): Promise<ActionResult> {
  if (!validDay(day) || !/^[0-9a-f-]{36}$/i.test(habitId)) return { ok: false, errorCode: "INVALID_INPUT" };
  const live = await liveUser();
  if (!live) return notSignedIn;
  const { supabase, userId } = live;
  const { error } = done
    ? await supabase.from("habit_logs").upsert(
        { habit_id: habitId, user_id: userId, date: day, client_generated_id: uuidFrom(`${habitId}:${day}`) },
        { onConflict: "client_generated_id", ignoreDuplicates: true },
      )
    : await supabase.from("habit_logs").delete().eq("habit_id", habitId).eq("date", day).eq("user_id", userId);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/today");
  revalidatePath("/habits");
  return { ok: true };
}

export async function addHabit(name: string, targetPerWeek: number): Promise<ActionResult> {
  if (!name.trim()) return { ok: false, message: "Give the habit a name" };
  const target = Math.min(Math.max(Math.round(targetPerWeek) || 7, 1), 7);
  const live = await liveUser();
  if (!live) return notSignedIn;
  const { supabase, userId } = live;
  // No target_per_week column: scheduling is `weekdays int[]` with 0=Sun. A
  // target of n means the first n days of the week, which is the closest this
  // simple form can express — a real weekday picker is the proper fix.
  const weekdays = Array.from({ length: target }, (_, i) => i);
  const { error } = await supabase.from("habits").insert({
    user_id: userId,
    created_by: userId,
    name: name.trim(),
    weekdays,
    active: true,
  });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/habits");
  return { ok: true };
}



/**
 * Remove a habit. Archived, not deleted: `active = false` takes it off Today
 * and Habits while its logs — and the adherence weeks they fed — stay
 * intact. RLS (habits_owner / habits_coach) decides whose habits can be
 * touched; the .eq on user_id is the app-side belt to that brace.
 */
export async function archiveHabit(habitId: string): Promise<ActionResult> {
  const live = await liveUser();
  if (!live) return notSignedIn;
  const { supabase, userId } = live;
  const failed = await mutated(
    await supabase.from("habits").update({ active: false }, { count: "exact" }).eq("id", habitId).eq("user_id", userId),
  );
  if (failed) return failed;
  revalidatePath("/today");
  revalidatePath("/habits");
  return { ok: true };
}
