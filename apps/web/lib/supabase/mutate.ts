import type { ActionResult } from "@/app/actions";
import { getI18n } from "@/lib/i18n/server";
import type { PostgrestError } from "@supabase/supabase-js";
import { insertOutcome, mutationOutcome, type MutationResult } from "./mutation-outcome";

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
  if (outcome === "error") return { ok: false, message: result.error?.message };
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
  if (outcome === "error") return { ok: false, message: error?.message };
  const { t } = await getI18n();
  return { ok: false, errorCode: "NO_ROWS", message: t.common.actions.nothingChanged };
}
