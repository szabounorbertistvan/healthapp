import type { ActionResult } from "@/app/actions";
import { getI18n } from "@/lib/i18n/server";
import type { PostgrestError } from "@supabase/supabase-js";
import { insertOutcome, isTransientDbError, mutationOutcome, type MutationResult } from "./mutation-outcome";

/**
 * PostgREST answers an RLS-filtered `update` or `delete` with success and zero
 * rows: `error` is null, nothing changed, and the caller would happily return
 * `{ ok: true }`. Every update and delete in the coach action files asks for
 * `{ count: "exact" }` and runs the result through here, so that silence
 * becomes an error the user can see instead of a refresh that shows old data.
 *
 * Returns `null` when a row was touched (carry on) and an `ActionResult`
 * otherwise (return it as-is).
 */
export async function mutated(result: MutationResult): Promise<ActionResult | null> {
  const outcome = mutationOutcome(result);
  if (outcome === "ok") return null;
  if (outcome === "error") return writeError(result.error);
  const { t } = await getI18n();
  return { ok: false, errorCode: "NO_ROWS", message: t.common.actions.nothingChanged };
}

/**
 * The insert-side twin of `mutated()`: an insert RLS refuses (42501) answers
 * with the same NO_ROWS result and sentence instead of Postgres's own text
 * ("new row violates row-level security policy for table …"). Returns `null`
 * when the insert went through.
 */
export async function inserted(error: PostgrestError | null): Promise<ActionResult | null> {
  const outcome = insertOutcome(error);
  if (outcome === "ok") return null;
  if (outcome === "error") return writeError(error);
  const { t } = await getI18n();
  return { ok: false, errorCode: "NO_ROWS", message: t.common.actions.nothingChanged };
}

/**
 * A write that failed with a database error. The real error is logged here.
 * A busy or unreachable database (a statement timeout, a dropped connection —
 * isTransientDbError) answers with the translated "could not be saved just
 * now" line; any other error keeps its message, because callers and screens
 * read business codes raised by the schema (PLAN_LIMIT_REACHED, …) from it.
 */
async function writeError(error: PostgrestError | null): Promise<ActionResult> {
  console.error("[db write] failed:", error?.code ?? "", error?.message ?? "");
  if (!isTransientDbError(error)) return { ok: false, message: error?.message };
  const { t } = await getI18n();
  return { ok: false, errorCode: "UNKNOWN", message: t.common.actions.saveFailed };
}

/**
 * A database error turned into something a person can read, for an action
 * whose screens show its message: RLS refusing (42501) is "nothing was saved,
 * this is no longer yours"; anything else — a timeout, a constraint, a
 * trigger's own English — is the translated "could not be saved just now".
 * The real error is logged with `where` so it can still be found.
 */
export async function dbFailure(error: Pick<PostgrestError, "code" | "message"> | null, where: string): Promise<ActionResult> {
  console.error(`[db] ${where} failed:`, error?.code ?? "", error?.message ?? "");
  const { t } = await getI18n();
  if (error?.code === "42501") return { ok: false, errorCode: "NO_ROWS", message: t.common.actions.nothingChanged };
  return { ok: false, errorCode: "UNKNOWN", message: t.common.actions.saveFailed };
}
