/**
 * Whether an editor opens editable — decided fail-closed. Only an explicit
 * `true` from the permission check (can_edit_program / can_edit_nutrition_plan,
 * 20261122100000) opens it; an explicit `false` is the read-only view of a
 * coaching that ended or is paused; anything else — an error, a thrown call, no
 * answer within the time limit, a missing or non-boolean result — is
 * "unverified": shown read-only too, with its own notice, never as editable.
 *
 * The database still decides every write; this only keeps the screen from
 * offering edits it could not confirm.
 */
export type EditAccess = "edit" | "read-only" | "unverified";

export const EDIT_CHECK_TIMEOUT_MS = 5_000;

/** The decision for one RPC answer, `{ data, error }` as supabase-js returns it. */
export function editAccessFrom(answer: { data: unknown; error: unknown } | null | undefined): EditAccess {
  if (!answer || answer.error) return "unverified";
  if (answer.data === true) return "edit";
  if (answer.data === false) return "read-only";
  return "unverified";
}

/** Asks `check` once; a throw, a rejection or no answer within `timeoutMs` is "unverified". */
export async function checkEditAccess(
  check: () => PromiseLike<{ data: unknown; error: unknown }>,
  timeoutMs = EDIT_CHECK_TIMEOUT_MS,
): Promise<EditAccess> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); });
  try {
    return editAccessFrom(await Promise.race([Promise.resolve().then(check), timedOut]));
  } catch {
    return "unverified";
  } finally {
    clearTimeout(timer);
  }
}
