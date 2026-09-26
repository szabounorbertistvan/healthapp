// "Ask an AI for feedback" on the Workout completed screen: the session just
// finished, what the program asked for, and the previous time the same day
// was trained, written out as one plain-text prompt the client can carry to
// whichever assistant they use. Only the owner's own sessions are read (the
// `user_id = viewer` filter, and RLS under it); the prompt carries numbers,
// sex and age — never a name, username or email.
import "server-only";
import { formatWeight, kgToDisplay, type WeightUnit } from "@healthapp/shared";
import { currentActorId } from "./actor";
import { supabaseServer } from "./supabase/server";
import { loadOf } from "./training-load";
import { fill, type Dictionary, type Locale } from "./i18n";
import { getProfile } from "./data";

type SetRow = {
  program_exercise_id: string | null; exercise_id: string | null; set_index: number;
  weight_kg: number | null; reps: number | null; rpe: number | null; rir: number | null;
  notes: string | null; is_pr: boolean | null; received_at: string;
  exercise: { name_en: string; name_ro: string | null } | null;
};
type SessionRow = {
  id: string; started_at: string; completed_at: string | null;
  day: {
    name: string;
    program: { intensity_mode: "rpe" | "rir" | "simple" } | null;
    program_exercises: { id: string; exercise_id: string; target_sets: number; target_reps: string }[] | null;
  } | null;
  logged_sets: SetRow[] | null;
};

const SETS = "program_exercise_id, exercise_id, set_index, weight_kg, reps, rpe, rir, notes, is_pr, received_at, exercise:exercises(name_en, name_ro)";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Sets grouped per exercise, in the order they were first logged. */
function byExercise(sets: SetRow[]): { key: string; row: SetRow; sets: SetRow[] }[] {
  const groups = new Map<string, { key: string; row: SetRow; sets: SetRow[] }>();
  const ordered = [...sets].sort((a, b) => a.received_at.localeCompare(b.received_at) || a.set_index - b.set_index);
  for (const s of ordered) {
    const key = s.exercise_id ?? s.exercise?.name_en ?? "?";
    const g = groups.get(key) ?? { key, row: s, sets: [] };
    g.sets.push(s);
    groups.set(key, g);
  }
  return [...groups.values()];
}

/**
 * The prompt text for one completed session, in the viewer's language, or
 * null when the session is not theirs. `dayId` comes from the URL and is only
 * used to find the previous session of the same day — both reads run in one
 * wave.
 */
export async function getWorkoutReviewPrompt(
  sessionId: string,
  dayId: string,
  locale: Locale,
  t: Dictionary,
): Promise<string | null> {
  const viewer = await currentActorId();
  if (!viewer) return null;
  const supabase = await supabaseServer();
  const [profile, { data: current }, { data: recent }] = await Promise.all([
    getProfile(),
    supabase
      .from("logged_sessions")
      .select(`id, started_at, completed_at, day:program_days(name, program:programs(intensity_mode), program_exercises(id, exercise_id, target_sets, target_reps)), logged_sets(${SETS})`)
      .eq("id", sessionId)
      .eq("user_id", viewer)
      .maybeSingle(),
    UUID.test(dayId)
      ? supabase
          .from("logged_sessions")
          .select(`id, started_at, completed_at, logged_sets(${SETS})`)
          .eq("user_id", viewer)
          .eq("program_day_id", dayId)
          .not("completed_at", "is", null)
          .neq("id", sessionId)
          .order("started_at", { ascending: false })
          .limit(3)
      : Promise.resolve({ data: [] }),
  ]);
  if (!current) return null;
  const row = current as unknown as SessionRow;
  const previous = ((recent ?? []) as unknown as SessionRow[])
    .find((s) => s.started_at < row.started_at && (s.logged_sets?.length ?? 0) > 0) ?? null;

  const p = t.common.aiReview.prompt;
  const unit: WeightUnit = profile?.weight_unit ?? "kg";
  const name = (s: SetRow) => (locale === "ro" ? s.exercise?.name_ro ?? s.exercise?.name_en : s.exercise?.name_en) ?? "—";
  const w = (kg: number | null) => (kg ? String(kgToDisplay(kg, unit)) : "0");
  const mode = row.day?.program?.intensity_mode ?? "rir";
  const effort = (s: SetRow) => {
    const bits: string[] = [];
    if (s.rir !== null && mode === "rir") bits.push(`RIR ${s.rir}`);
    if (s.rpe !== null) bits.push(`RPE ${s.rpe}`);
    return bits.length ? ` @ ${bits.join(", ")}` : "";
  };
  const setText = (s: SetRow) => `${w(s.weight_kg)}×${s.reps ?? 0}${effort(s)}`;

  const sets = row.logged_sets ?? [];
  const load = loadOf(
    sets.map((s) => ({ ...s, exercise: s.exercise_id })),
    row.started_at,
    row.completed_at,
  );
  const targets = new Map((row.day?.program_exercises ?? []).map((e) => [e.id, e]));
  const before = new Map(byExercise(previous?.logged_sets ?? []).map((g) => [g.key, g.sets]));

  const lines: string[] = [p.ask, ""];
  lines.push(fill(p.workout, { name: row.day?.name ?? "Workout", date: row.started_at.slice(0, 10) }));
  if (load.duration_min) lines.push(fill(p.duration, { min: load.duration_min }));
  const who: string[] = [];
  if (profile?.sex === "male") who.push(p.male);
  if (profile?.sex === "female") who.push(p.female);
  if (profile?.birth_year) who.push(fill(p.age, { age: new Date().getFullYear() - profile.birth_year }));
  if (who.length) lines.push(fill(p.athlete, { who: who.join(", ") }));
  if (mode !== "simple") lines.push(fill(p.scale, { scale: mode.toUpperCase() }));
  lines.push(`(${unit})`, "");

  for (const g of byExercise(sets)) {
    const target = g.row.program_exercise_id ? targets.get(g.row.program_exercise_id) : undefined;
    lines.push(`${name(g.row)}${target ? ` (${fill(p.target, { sets: target.target_sets, reps: target.target_reps })})` : ""}`);
    lines.push(`- ${p.sets}: ${g.sets.map(setText).join(", ")}`);
    const notes = g.sets.map((s) => s.notes?.trim()).filter(Boolean);
    if (notes.length) lines.push(`- ${p.notes}: ${notes.join("; ")}`);
    const last = before.get(g.key);
    if (last && previous) lines.push(`- ${fill(p.lastTime, { date: previous.started_at.slice(0, 10) })}: ${last.map(setText).join(", ")}`);
  }

  lines.push("", fill(p.totals, {
    exercises: load.exercises, sets: load.sets,
    volume: formatWeight(load.volume_kg, unit, { locale }),
  }));
  const prs = sets.filter((s) => s.is_pr);
  if (prs.length) lines.push(`${p.prs}: ${prs.map((s) => `${name(s)} ${setText(s)}`).join("; ")}`);
  return lines.join("\n");
}
