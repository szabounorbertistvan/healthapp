import type { PostgrestError } from "@supabase/supabase-js";

export type MutationResult = { error: PostgrestError | null; count: number | null };

/**
 * Pure core of `mutated()` (see ./mutate.ts). Kept free of Next imports so the
 * root Vitest run can load it without an `@/` alias or a request context.
 */
export function mutationOutcome(result: MutationResult): "error" | "no_rows" | "ok" {
  if (result.error) return "error";
  // A null count means the caller forgot { count: "exact" }: fail loudly
  // rather than let that silently reintroduce the bug this guard exists for.
  if (result.count === null || result.count === 0) return "no_rows";
  return "ok";
}

/**
 * Pure core of `inserted()` (see ./mutate.ts). RLS refuses an insert outright
 * — SQLSTATE 42501, "new row violates row-level security policy" — where it
 * filters an update or delete to zero rows. To the person both mean the same:
 * the thing is no longer theirs to change (a coaching that was paused or
 * ended, a program they do not own). Any other error stays an error.
 */
export function insertOutcome(error: PostgrestError | null): "ok" | "refused" | "error" {
  if (!error) return "ok";
  return error.code === "42501" ? "refused" : "error";
}
