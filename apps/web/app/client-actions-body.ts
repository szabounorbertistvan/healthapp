"use server";
// Measurements and the weekly check-in.
import { revalidatePath } from "next/cache";
import { isoDay } from "@/lib/dates";
import { myToday } from "@/lib/my-today";
import { liveUser } from "@/lib/supabase/server";
import { weekStartOf } from "@healthapp/shared";
import type { ActionResult } from "./actions";
import { notSignedIn } from "@/lib/action-result";



export async function addMeasurement(input: {
  weightKg: number | null;
  waistCm: number | null;
  takenOn?: string;
}): Promise<ActionResult> {
  if (input.weightKg === null && input.waistCm === null) {
    return { ok: false, message: "Enter a weight or a waist measurement" };
  }
  const takenOn = input.takenOn ?? isoDay();
  const live = await liveUser();
  if (!live) return notSignedIn;
  const { supabase, userId } = live;
  // The upsert replaces the whole row, so read what is already there first.
  // Waist lives inside the circumferences jsonb, and weight_kg is a plain
  // column — both have to be carried forward, or a waist-only entry in the
  // evening blanks the morning's weigh-in (and vice versa).
  const { data: existing } = await supabase
    .from("measurements")
    .select("weight_kg, circumferences")
    .eq("user_id", userId)
    .eq("date", takenOn)
    .maybeSingle();
  const circumferences: Record<string, number> = {
    ...((existing?.circumferences as Record<string, number> | null) ?? {}),
  };
  if (input.waistCm !== null) circumferences.waist = input.waistCm;

  const { error } = await supabase.from("measurements").upsert(
    {
      user_id: userId,
      date: takenOn,
      weight_kg: input.weightKg ?? existing?.weight_kg ?? null,
      circumferences,
    },
    { onConflict: "user_id,date" },
  );
  if (error) return { ok: false, message: error.message };
  revalidatePath("/progress");
  return { ok: true };
}



export async function submitCheckIn(input: {
  weightKg: number | null;
  sleep: number;
  energy: number;
  stress: number;
  hunger: number;
  recovery: number;
  note: string;
}): Promise<ActionResult> {
  // The person's Monday — the week getMyCheckInState and the coach's adherence read.
  const weekStart = weekStartOf(await myToday());

  const live = await liveUser();
  if (!live) return notSignedIn;
  const { supabase, userId } = live;
  // check_ins is unique on (user_id, week_start). Say so in words rather than
  // letting the constraint violation reach the form.
  const { data: already } = await supabase
    .from("check_ins")
    .select("id")
    .eq("user_id", userId)
    .eq("week_start", weekStart)
    .maybeSingle();
  if (already) return { ok: false, errorCode: "ALREADY_CHECKED_IN", message: "This week is already checked in" };

  const { error } = await supabase.from("check_ins").insert({
    user_id: userId,
    week_start: weekStart,
    weight_kg: input.weightKg,
    sleep: input.sleep,
    energy: input.energy,
    stress: input.stress,
    hunger: input.hunger,
    recovery: input.recovery,
    note: input.note.trim() || null,
    submitted_at: new Date().toISOString(),
  });
  // A double tap can still race past the check above; 23505 means the same thing.
  if (error) {
    return {
      ok: false,
      message: error.code === "23505" ? "This week is already checked in" : error.message,
      ...(error.code === "23505" ? { errorCode: "ALREADY_CHECKED_IN" as const } : {}),
    };
  }
  revalidatePath("/check-in");
  revalidatePath("/today");
  return { ok: true };
}
