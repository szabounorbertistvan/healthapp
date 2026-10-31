"use server";
// Measurements and the weekly check-in.
import { revalidatePath } from "next/cache";
import { isoDay } from "@/lib/dates";
import { myToday } from "@/lib/my-today";
import { liveUser } from "@/lib/supabase/server";
import { GOAL_METRIC_SPEC, weekStartOf } from "@healthapp/shared";
import type { ActionResult } from "./actions";
import { notSignedIn } from "@/lib/action-result";
import { fill } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";

/** A weigh-in's plausible range — measurements.weight_kg's check constraint (20..400). */
const WEIGHT = GOAL_METRIC_SPEC.body_weight;



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
  /**
   * Answers to the coach's own questions (20261207120000): a number for a
   * scale or number question, true/false for yes/no, text for text. The
   * database copies each question's words and refuses an answer of the wrong
   * kind or to a question not meant for this client.
   */
  answers?: { questionId: string; value: number | boolean | string }[];
}): Promise<ActionResult> {
  // A weight outside a person's range is a typo; check_ins.weight_kg is
  // numeric(5,2), so 9999 would otherwise come back as "numeric field overflow".
  if (input.weightKg !== null && !(input.weightKg >= WEIGHT.min && input.weightKg <= WEIGHT.max)) {
    const { t } = await getI18n();
    return { ok: false, errorCode: "INVALID_INPUT", message: fill(t.clientWidgets.checkInForm.weightRange, { min: WEIGHT.min, max: WEIGHT.max, unit: "kg" }) };
  }
  // The person's Monday — the week getMyCheckInState and the coach's adherence read.
  const today = await myToday();
  const weekStart = weekStartOf(today);

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

  const { data: created, error } = await supabase.from("check_ins").insert({
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
  }).select("id").single();
  // A double tap can still race past the check above; 23505 means the same thing.
  if (error) {
    if (error.code === "23505") return { ok: false, errorCode: "ALREADY_CHECKED_IN", message: "This week is already checked in" };
    // never the database's own words on the screen
    console.error("check-in refused:", error.code);
    const { t } = await getI18n();
    return { ok: false, message: t.clientWidgets.checkInForm.couldNotSubmit };
  }
  // The weight is a weigh-in too: Progress, the weekly report and the coach's
  // charts all read measurements, so it is written there for today (the
  // person's day), keeping any waist already logged. A refusal here never
  // undoes the check-in.
  if (input.weightKg !== null) {
    const weighIn = await addMeasurement({ weightKg: input.weightKg, waistCm: null, takenOn: today });
    if (!weighIn.ok) console.error("check-in weigh-in refused");
  }
  // the coach's questions, after the check-in exists; a refused answer never undoes the check-in
  const answers = (input.answers ?? [])
    .filter((a) => /^[0-9a-f-]{36}$/i.test(a.questionId))
    .slice(0, 12)
    .map((a) => ({
      check_in_id: (created as { id: string }).id,
      question_id: a.questionId,
      value_num: typeof a.value === "number" && Number.isFinite(a.value) ? a.value : null,
      value_bool: typeof a.value === "boolean" ? a.value : null,
      value_text: typeof a.value === "string" && a.value.trim() ? a.value.trim().slice(0, 1000) : null,
    }))
    .filter((a) => a.value_num !== null || a.value_bool !== null || a.value_text !== null);
  for (const a of answers) {
    const { error: answerError } = await supabase.from("check_in_answers").insert(a);
    if (answerError) console.error("check-in answer refused:", answerError.code);
  }
  revalidatePath("/check-in");
  revalidatePath("/today");
  revalidatePath("/check-ins");
  revalidatePath("/progress");
  return { ok: true };
}
