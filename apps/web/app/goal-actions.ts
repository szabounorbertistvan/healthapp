"use server";
// Writes for the Goal dashboard (Progress → Goals): create, adjust, close,
// delete a measurable goal. The row is the person's own (goals_owner:
// user_id = auth.uid()); these actions validate, the database enforces —
// the same rules twice (validateGoalInput here, the 20261125110000 checks,
// the one-active-goal-per-source index and goals_guard there), so a call
// that skips the screen still cannot store a goal the screen would refuse.
//
// Progress is never written: it is computed on read from the person's data.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { GOAL_METRIC_SPEC, isGoalMetric, isPlanLimitError, validateGoalInput, type GoalErrorCode } from "@healthapp/shared";
import { notSignedIn, planLimitReached } from "@/lib/action-result";
import { getI18n } from "@/lib/i18n/server";
import { myToday } from "@/lib/my-today";
import { liveUser } from "@/lib/supabase/server";
import { mutated } from "@/lib/supabase/mutate";
import { id, num, parseInput, text } from "@/lib/validate";
import type { ActionResult } from "./actions";

const TITLE_MAX = 80;

function goalsTouched() {
  revalidatePath("/progress");
}

async function refused(code: GoalErrorCode): Promise<ActionResult> {
  const { t } = await getI18n();
  return { ok: false, errorCode: code, message: t.clientApp.goals.errors[code] };
}

/** A database refusal, in the person's words: the plan limit, the duplicate index, the cap, the exercise guard, a check. */
async function fromDatabase(error: { code?: string; message: string }): Promise<ActionResult> {
  // the plan's active-goal limit (20261128100000) — the screen shows the upgrade hint
  if (isPlanLimitError(error.message)) return planLimitReached;
  if (error.code === "23505") return refused("GOAL_DUPLICATE");
  if (error.message.includes("GOAL_LIMIT")) return refused("GOAL_LIMIT");
  if (error.message.includes("GOAL_EXERCISE")) return refused("GOAL_EXERCISE");
  if (error.code === "23514") return refused("GOAL_TARGET");
  return { ok: false, message: error.message };
}

const CreateGoalInput = z.object({
  metric: text(40),
  direction: text(20),
  targetValue: num,
  startValue: num.nullable(),
  targetDate: z.string().max(10).nullable(),
  exerciseId: id.nullable(),
  measureKey: text(20).nullable(),
  title: text(TITLE_MAX).nullable(),
});

/**
 * A new active goal, starting today on the person's own calendar. Values
 * arrive in canonical units (kg, cm, workouts a week, %, g) — the form
 * converts from the person's display units, as the weigh-in form does.
 */
export async function createGoal(input: z.input<typeof CreateGoalInput>): Promise<ActionResult & { id?: string }> {
  const parsed = await parseInput(CreateGoalInput, input);
  if (!parsed.ok) return parsed.result;
  const live = await liveUser();
  if (!live) return notSignedIn;
  const { supabase, userId } = live;
  const today = await myToday();
  const { t } = await getI18n();

  const goal = {
    metric: input.metric,
    direction: input.direction,
    target_value: input.targetValue,
    start_value: input.startValue,
    start_date: today,
    target_date: input.targetDate || null,
    exercise_id: input.exerciseId,
    measure_key: input.measureKey || null,
  };
  const invalid = validateGoalInput(goal, today);
  if (invalid) return refused(invalid);
  // validateGoalInput accepted the metric; narrow it for the lookups below
  if (!isGoalMetric(goal.metric)) return refused("GOAL_METRIC");

  const title = input.title?.trim().slice(0, TITLE_MAX) || t.clientApp.goals.metric[goal.metric];
  const { data, error } = await supabase
    .from("goals")
    .insert({ user_id: userId, type: GOAL_METRIC_SPEC[goal.metric].type, title, status: "active", ...goal })
    .select("id")
    .single();
  if (error) return fromDatabase(error);
  goalsTouched();
  return { ok: true, id: (data as { id: string }).id, message: t.clientApp.goals.created };
}

type StoredGoal = {
  id: string; metric: string | null; direction: string | null; target_value: number | string | null;
  start_value: number | string | null; start_date: string | null; target_date: string | null;
  exercise_id: string | null; measure_key: string | null; status: string;
};

async function readOwnGoal(goalId: string): Promise<{ row: StoredGoal } | { result: ActionResult }> {
  const live = await liveUser();
  if (!live) return { result: notSignedIn };
  const { data, error } = await live.supabase
    .from("goals")
    .select("id, metric, direction, target_value, start_value, start_date, target_date, exercise_id, measure_key, status")
    .eq("id", goalId)
    .eq("user_id", live.userId)
    .maybeSingle<StoredGoal>();
  if (error) return { result: { ok: false, message: error.message } };
  // Not found and not mine read the same: nothing to change.
  if (!data || data.metric === null) {
    const { t } = await getI18n();
    return { result: { ok: false, errorCode: "NO_ROWS", message: t.common.actions.nothingChanged } };
  }
  return { row: data };
}

const UpdateGoalInput = z.object({
  goalId: id,
  targetValue: num.optional(),
  targetDate: z.string().max(10).nullable().optional(),
  title: text(TITLE_MAX).optional(),
});

/**
 * Change an active goal's target, deadline or name. Metric, start and source
 * stay as they were — a different question is a new goal, so history keeps
 * meaning what it meant. A deadline already in the past may stay (the goal
 * then shows as overdue); only a deadline being set now must not be past.
 */
export async function updateGoal(input: z.input<typeof UpdateGoalInput>): Promise<ActionResult> {
  const parsed = await parseInput(UpdateGoalInput, input);
  if (!parsed.ok) return parsed.result;
  const found = await readOwnGoal(input.goalId);
  if ("result" in found) return found.result;
  const { row } = found;
  if (row.status !== "active") return refused("GOAL_STATUS");

  const deadlineChanged = input.targetDate !== undefined && (input.targetDate || null) !== row.target_date;
  const merged = {
    metric: row.metric ?? "",
    direction: row.direction ?? "",
    target_value: input.targetValue ?? Number(row.target_value),
    start_value: row.start_value === null ? null : Number(row.start_value),
    start_date: row.start_date ?? "",
    target_date: input.targetDate !== undefined ? (input.targetDate || null) : row.target_date,
    exercise_id: row.exercise_id,
    measure_key: row.measure_key,
  };
  const invalid = validateGoalInput(merged, await myToday(), { deadlineFromToday: deadlineChanged });
  if (invalid) return refused(invalid);

  const patch: Record<string, string | number | null> = { target_value: merged.target_value, target_date: merged.target_date };
  if (input.title !== undefined && input.title.trim()) patch.title = input.title.trim().slice(0, TITLE_MAX);

  const live = await liveUser();
  if (!live) return notSignedIn;
  const { error, count } = await live.supabase
    .from("goals").update(patch, { count: "exact" }).eq("id", row.id).eq("status", "active");
  if (error) return fromDatabase(error);
  const failed = await mutated({ error: null, count });
  if (failed) return failed;
  goalsTouched();
  const { t } = await getI18n();
  return { ok: true, message: t.clientApp.goals.saved };
}

/**
 * Close an active goal: achieved or abandoned. Always the person's call —
 * the dashboard says when the data has reached the target, it never closes a
 * goal by itself. Only an active goal moves (the filter on status), so a
 * second tap, or a tap on a goal already closed elsewhere, changes nothing
 * and says so. Closed goals stay as history; nothing is deleted.
 */
export async function closeGoal(goalId: string, outcome: "achieved" | "abandoned"): Promise<ActionResult> {
  const parsed = await parseInput(z.tuple([id, z.enum(["achieved", "abandoned"])]), [goalId, outcome]);
  if (!parsed.ok) return parsed.result;
  const live = await liveUser();
  if (!live) return notSignedIn;
  const now = new Date().toISOString();
  const failed = await mutated(
    await live.supabase
      .from("goals")
      .update(
        { status: outcome, closed_at: now, achieved_at: outcome === "achieved" ? now : null },
        { count: "exact" },
      )
      .eq("id", goalId)
      .eq("user_id", live.userId)
      .eq("status", "active")
      .not("metric", "is", null),
  );
  if (failed) return failed;
  goalsTouched();
  const { t } = await getI18n();
  return { ok: true, message: outcome === "achieved" ? t.clientApp.goals.markedAchieved : t.clientApp.goals.markedAbandoned };
}

/**
 * Remove a goal for good — for one created by mistake. Measurable goals only:
 * the setup step's main goal (metric is null) is not this screen's to delete.
 * The person's measurements, sets and meals are untouched; only the goal row goes.
 */
export async function deleteGoal(goalId: string): Promise<ActionResult> {
  const parsed = await parseInput(id, goalId);
  if (!parsed.ok) return parsed.result;
  const live = await liveUser();
  if (!live) return notSignedIn;
  const failed = await mutated(
    await live.supabase
      .from("goals")
      .delete({ count: "exact" })
      .eq("id", goalId)
      .eq("user_id", live.userId)
      .not("metric", "is", null),
  );
  if (failed) return failed;
  goalsTouched();
  const { t } = await getI18n();
  return { ok: true, message: t.clientApp.goals.deleted };
}
